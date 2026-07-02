// Repositories: única API con la que la UI/stores tocan la persistencia.
// La UI nunca llama a Dexie directo; pasa por aquí.

import type {
  BaseWeek,
  Checkin,
  Exercise,
  MesocyclePlan,
  ProgressionModel,
  SetLog,
} from "@/domain/types";
import { getRules } from "@/lib/rulesLoader";
import { uuid } from "@/lib/id";
import { generateMesocycle } from "@/domain/mesocycle";
import { getDb, type ActivityRow, type BaseWeekRow, type MeasurementRow, type MesocycleRow, type SessionRow, type SettingsRow } from "./schema";
import { SEED_VERSION, defaultSettings, seedExercises } from "./seed";

// ---- Bootstrap ----

/**
 * Siembra ejercicios y settings por defecto. Idempotente. Si la biblioteca de
 * ejercicios cambió de versión (SEED_VERSION), la reemplaza por la nueva sin
 * tocar el resto de los datos del usuario.
 */
export async function ensureSeeded(): Promise<void> {
  const db = getDb();
  const settings = await db.settings.get("default");
  if (!settings) {
    await db.settings.put(defaultSettings());
  }
  const bw = await db.baseWeek.get("default");
  if (!bw) {
    await db.baseWeek.put({ id: "default", days: [] });
  }

  const count = await db.exercises.count();
  const seededVersion = settings?.seedVersion ?? 0;
  if (count === 0 || seededVersion < SEED_VERSION) {
    await db.transaction("rw", db.exercises, db.settings, async () => {
      // Preservar los ejercicios creados por el usuario al re-sembrar la biblioteca.
      const custom = await db.exercises.filter((e) => e.custom === true).toArray();
      await db.exercises.clear();
      await db.exercises.bulkPut(seedExercises);
      if (custom.length > 0) await db.exercises.bulkPut(custom);
      await db.settings.update("default", { seedVersion: SEED_VERSION });
    });
  }
}

// ---- Settings ----

export const settingsRepo = {
  async get(): Promise<SettingsRow> {
    const db = getDb();
    const s = await db.settings.get("default");
    if (s) return s;
    const d = defaultSettings();
    await db.settings.put(d);
    return d;
  },
  async update(patch: Partial<Omit<SettingsRow, "id">>): Promise<void> {
    const db = getDb();
    await db.settings.update("default", patch);
  },
};

// ---- Ejercicios ----

export const exerciseRepo = {
  async all(): Promise<Exercise[]> {
    return getDb().exercises.toArray();
  },
  async get(id: string): Promise<Exercise | undefined> {
    return getDb().exercises.get(id);
  },
  async byId(): Promise<Map<string, Exercise>> {
    const all = await getDb().exercises.toArray();
    return new Map(all.map((e) => [e.id, e]));
  },
  async put(exercise: Exercise): Promise<void> {
    await getDb().exercises.put(exercise);
  },
  /** Crea un ejercicio personalizado del usuario. */
  async createCustom(data: Omit<Exercise, "id" | "custom">): Promise<Exercise> {
    const exercise: Exercise = { ...data, id: uuid(), custom: true };
    await getDb().exercises.put(exercise);
    return exercise;
  },
  async update(id: string, patch: Partial<Exercise>): Promise<void> {
    await getDb().exercises.update(id, patch);
  },
  /**
   * Elimina un ejercicio. Además lo quita de la semana base y de los
   * swapCandidates de otros ejercicios para no dejar referencias colgadas.
   */
  async remove(id: string): Promise<void> {
    const db = getDb();
    await db.transaction("rw", db.exercises, db.baseWeek, async () => {
      await db.exercises.delete(id);
      const others = await db.exercises.filter((e) => e.swapCandidates.includes(id)).toArray();
      for (const o of others) {
        await db.exercises.update(o.id, {
          swapCandidates: o.swapCandidates.filter((c) => c !== id),
        });
      }
      const bw = await db.baseWeek.get("default");
      if (bw) {
        const days = bw.days.map((d) => ({
          ...d,
          slots: d.slots.filter((s) => s.exerciseId !== id),
        }));
        await db.baseWeek.put({ id: "default", days });
      }
    });
  },
};

// ---- Semana base ----

export const baseWeekRepo = {
  async get(): Promise<BaseWeek> {
    const bw = await getDb().baseWeek.get("default");
    return bw ?? { days: [] };
  },
  async set(baseWeek: BaseWeek): Promise<void> {
    await getDb().baseWeek.put({ id: "default", ...baseWeek });
  },
};

// ---- Mesociclos ----

export const mesocycleRepo = {
  async all(): Promise<MesocycleRow[]> {
    return getDb().mesocycles.orderBy("createdAt").reverse().toArray();
  },
  async get(id: string): Promise<MesocycleRow | undefined> {
    return getDb().mesocycles.get(id);
  },
  async active(): Promise<MesocycleRow | undefined> {
    return getDb().mesocycles.where("status").equals("active").first();
  },

  /**
   * Genera un mesociclo desde la semana base actual y crea sus sesiones.
   * Marca cualquier meso activo previo como completado.
   */
  async createFromBaseWeek(args: {
    name: string;
    progressionModel: ProgressionModel;
    numAccumulationWeeks: number;
  }): Promise<MesocycleRow> {
    const db = getDb();
    const rules = getRules();
    const [baseWeek, exercises, settings] = await Promise.all([
      baseWeekRepo.get(),
      exerciseRepo.all(),
      settingsRepo.get(),
    ]);

    const plan: MesocyclePlan = generateMesocycle({
      baseWeek,
      exercises,
      profile: settings.experienceProfile,
      progressionModel: args.progressionModel,
      numAccumulationWeeks: args.numAccumulationWeeks,
      prioritizedMuscles: settings.prioritizedMuscles,
      rules,
    });

    const meso: MesocycleRow = {
      id: uuid(),
      name: args.name,
      createdAt: new Date().toISOString(),
      numAccumulationWeeks: plan.numAccumulationWeeks,
      deloadWeeks: 1,
      progressionModel: args.progressionModel,
      status: "active",
      plan,
    };

    const sessions: SessionRow[] = [];
    for (const week of plan.weeks) {
      week.days.forEach((day, dayIndex) => {
        sessions.push({
          id: uuid(),
          mesocycleId: meso.id,
          weekIndex: week.weekIndex,
          dayIndex,
          dayLabel: day.label,
          isDeload: week.isDeload,
          status: "pending",
        });
      });
    }

    await db.transaction("rw", db.mesocycles, db.sessions, async () => {
      const prevActive = await db.mesocycles.where("status").equals("active").toArray();
      for (const p of prevActive) {
        await db.mesocycles.update(p.id, { status: "completed" });
      }
      await db.mesocycles.put(meso);
      await db.sessions.bulkPut(sessions);
    });

    return meso;
  },

  async setStatus(id: string, status: MesocycleRow["status"]): Promise<void> {
    await getDb().mesocycles.update(id, { status });
  },
};

// ---- Sesiones ----

export const sessionRepo = {
  async forMesocycle(mesocycleId: string): Promise<SessionRow[]> {
    const rows = await getDb().sessions.where("mesocycleId").equals(mesocycleId).toArray();
    return rows.sort((a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex);
  },
  async get(id: string): Promise<SessionRow | undefined> {
    return getDb().sessions.get(id);
  },
  /** Primera sesión pendiente del meso (en orden semana/día). */
  async nextPending(mesocycleId: string): Promise<SessionRow | undefined> {
    const rows = await sessionRepo.forMesocycle(mesocycleId);
    return rows.find((s) => s.status === "pending");
  },
  async complete(id: string): Promise<void> {
    await getDb().sessions.update(id, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
  },
  async skip(id: string): Promise<void> {
    await getDb().sessions.update(id, { status: "skipped" });
  },
};

// ---- Set logs ----

export const setLogRepo = {
  async forSession(sessionId: string): Promise<SetLog[]> {
    const rows = await getDb().setLogs.where("sessionId").equals(sessionId).toArray();
    return rows.sort((a, b) => a.setIndex - b.setIndex);
  },
  async forExercise(exerciseId: string): Promise<SetLog[]> {
    return getDb().setLogs.where("exerciseId").equals(exerciseId).toArray();
  },
  async put(log: SetLog): Promise<void> {
    await getDb().setLogs.put(log);
  },
  async remove(id: string): Promise<void> {
    await getDb().setLogs.delete(id);
  },
};

// ---- Check-ins ----

export const checkinRepo = {
  async forSession(sessionId: string): Promise<Checkin | undefined> {
    return getDb().checkins.where("sessionId").equals(sessionId).first();
  },
  async put(checkin: Checkin): Promise<void> {
    await getDb().checkins.put(checkin);
  },
  async all(): Promise<Checkin[]> {
    return getDb().checkins.toArray();
  },
};

// ---- Actividades extra (cardio/deporte, opcional) ----

export const activityRepo = {
  async all(): Promise<ActivityRow[]> {
    return getDb().activities.orderBy("date").toArray();
  },
  async inRange(fromIso: string, toIso: string): Promise<ActivityRow[]> {
    return getDb().activities.where("date").between(fromIso, toIso, true, true).toArray();
  },
  async add(a: Omit<ActivityRow, "id">): Promise<void> {
    await getDb().activities.put({ ...a, id: uuid() });
  },
  async remove(id: string): Promise<void> {
    await getDb().activities.delete(id);
  },
};

// ---- Medidas corporales ----

export const measurementRepo = {
  async all(): Promise<MeasurementRow[]> {
    return getDb().measurements.orderBy("date").toArray();
  },
  async latest(): Promise<MeasurementRow | undefined> {
    return getDb().measurements.orderBy("date").last();
  },
  async add(m: Omit<MeasurementRow, "id">): Promise<void> {
    await getDb().measurements.put({ ...m, id: uuid() });
  },
  async remove(id: string): Promise<void> {
    await getDb().measurements.delete(id);
  },

  /**
   * ¿Corresponde sugerir re-registrar medidas? (fin de meso posterior a la
   * última medición, o más de ~6 meses sin medir). Aviso neutral, no bloquea.
   */
  async pendingPrompt(): Promise<{ trigger: "meso_end" | "periodic" } | null> {
    const db = getDb();
    const settings = await db.settings.get("default");
    if (!settings?.onboarded) return null;
    const last = await db.measurements.orderBy("date").last();

    const completedMesos = await db.mesocycles.where("status").equals("completed").toArray();
    let lastMesoEnd: string | null = null;
    for (const m of completedMesos) {
      const sessions = await db.sessions.where("mesocycleId").equals(m.id).toArray();
      const ends = sessions.map((s) => s.completedAt).filter((x): x is string => !!x);
      const end = ends.sort().pop() ?? m.createdAt;
      if (!lastMesoEnd || end > lastMesoEnd) lastMesoEnd = end;
    }

    if (lastMesoEnd && (!last || last.date < lastMesoEnd)) return { trigger: "meso_end" };
    const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
    if (last && Date.now() - Date.parse(last.date) > SIX_MONTHS_MS) return { trigger: "periodic" };
    return null;
  },
};

// ---- Backup / restore (respaldo completo en JSON) ----

export interface BackupFile {
  app: "hypertrophy";
  backupVersion: 1;
  exportedAt: string;
  data: {
    settings: SettingsRow[];
    baseWeek: BaseWeekRow[];
    exercises: Exercise[];
    mesocycles: MesocycleRow[];
    sessions: SessionRow[];
    setLogs: SetLog[];
    checkins: Checkin[];
    measurements?: MeasurementRow[];
    activities?: ActivityRow[];
  };
}

export const backupRepo = {
  /** Serializa TODA la base local a un objeto de respaldo. */
  async export(): Promise<BackupFile> {
    const db = getDb();
    const [settings, baseWeek, exercises, mesocycles, sessions, setLogs, checkins, measurements, activities] =
      await Promise.all([
        db.settings.toArray(),
        db.baseWeek.toArray(),
        db.exercises.toArray(),
        db.mesocycles.toArray(),
        db.sessions.toArray(),
        db.setLogs.toArray(),
        db.checkins.toArray(),
        db.measurements.toArray(),
        db.activities.toArray(),
      ]);
    return {
      app: "hypertrophy",
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      data: { settings, baseWeek, exercises, mesocycles, sessions, setLogs, checkins, measurements, activities },
    };
  },

  /**
   * Reemplaza TODOS los datos locales con el contenido del respaldo.
   * Valida el shape mínimo y falla ruidoso si no es un respaldo válido.
   */
  async import(raw: unknown): Promise<void> {
    const b = raw as Partial<BackupFile>;
    if (!b || b.app !== "hypertrophy" || b.backupVersion !== 1 || !b.data) {
      throw new Error("El archivo no es un respaldo válido de esta app.");
    }
    const d = b.data;
    const tables = ["settings", "baseWeek", "exercises", "mesocycles", "sessions", "setLogs", "checkins"] as const;
    for (const t of tables) {
      if (!Array.isArray(d[t])) throw new Error(`Respaldo corrupto: falta la tabla "${t}".`);
    }
    const db = getDb();
    await db.transaction(
      "rw",
      [db.settings, db.baseWeek, db.exercises, db.mesocycles, db.sessions, db.setLogs, db.checkins, db.measurements, db.activities],
      async () => {
        await Promise.all([
          db.settings.clear(), db.baseWeek.clear(), db.exercises.clear(),
          db.mesocycles.clear(), db.sessions.clear(), db.setLogs.clear(), db.checkins.clear(),
          db.measurements.clear(), db.activities.clear(),
        ]);
        await db.settings.bulkPut(d.settings);
        await db.baseWeek.bulkPut(d.baseWeek);
        await db.exercises.bulkPut(d.exercises);
        await db.mesocycles.bulkPut(d.mesocycles);
        await db.sessions.bulkPut(d.sessions);
        await db.setLogs.bulkPut(d.setLogs);
        await db.checkins.bulkPut(d.checkins);
        if (Array.isArray(d.measurements)) await db.measurements.bulkPut(d.measurements);
        if (Array.isArray(d.activities)) await db.activities.bulkPut(d.activities);
      },
    );
  },
};
