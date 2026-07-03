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
import { deriveBaseWeekFromPlan, generateMesocycle } from "@/domain/mesocycle";
import { groupBySession, nextPrescription } from "@/domain/progression";
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
   * El meso activo previo queda pausado (o completado si no le quedan sesiones).
   */
  async createFromBaseWeek(args: {
    name: string;
    progressionModel: ProgressionModel;
    numAccumulationWeeks: number;
    /** Semana base explícita (continuación de meso); default: la semana base guardada. */
    baseWeekOverride?: BaseWeek;
    continuedFromId?: string;
  }): Promise<MesocycleRow> {
    const db = getDb();
    const rules = getRules();
    const [savedBaseWeek, exercises, settings] = await Promise.all([
      baseWeekRepo.get(),
      exerciseRepo.all(),
      settingsRepo.get(),
    ]);
    const baseWeek = args.baseWeekOverride ?? savedBaseWeek;

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
      continuedFromId: args.continuedFromId,
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
        const pending = await db.sessions
          .where("mesocycleId").equals(p.id)
          .filter((x) => x.status === "pending")
          .count();
        // Si ya no le quedan sesiones, estaba terminado; si le quedan, queda en pausa.
        await db.mesocycles.update(p.id, { status: pending === 0 ? "completed" : "paused" });
      }
      await db.mesocycles.put(meso);
      await db.sessions.bulkPut(sessions);
    });

    return meso;
  },

  async setStatus(id: string, status: MesocycleRow["status"]): Promise<void> {
    await getDb().mesocycles.update(id, { status });
  },

  /** Pausa un meso empezado para intercalar otro. Reanudable con activate(). */
  async pause(id: string): Promise<void> {
    await getDb().mesocycles.update(id, { status: "paused" });
  },

  /** Activa un meso (pausa al activo actual, o lo completa si no le quedan sesiones). */
  async activate(id: string): Promise<void> {
    const db = getDb();
    await db.transaction("rw", db.mesocycles, db.sessions, async () => {
      const actives = await db.mesocycles.where("status").equals("active").toArray();
      for (const a of actives) {
        if (a.id === id) continue;
        const pending = await db.sessions
          .where("mesocycleId").equals(a.id)
          .filter((x) => x.status === "pending")
          .count();
        await db.mesocycles.update(a.id, { status: pending === 0 ? "completed" : "paused" });
      }
      await db.mesocycles.update(id, { status: "active" });
    });
  },

  /** Elimina un meso con todo lo suyo (sesiones, series, check-ins). Irreversible. */
  async remove(id: string): Promise<void> {
    const db = getDb();
    await db.transaction("rw", db.mesocycles, db.sessions, db.setLogs, db.checkins, async () => {
      const sessionIds = (await db.sessions.where("mesocycleId").equals(id).toArray()).map((x) => x.id);
      await db.setLogs.where("sessionId").anyOf(sessionIds).delete();
      await db.checkins.where("sessionId").anyOf(sessionIds).delete();
      await db.sessions.where("mesocycleId").equals(id).delete();
      await db.mesocycles.delete(id);
    });
  },

  /**
   * Genera la CONTINUACIÓN de un meso terminado: misma estructura (semana 1 del
   * plan original) pero con cargas heredadas del rendimiento REAL, calculadas
   * por el motor de progresión sobre el historial sin la semana de deload
   * (las cargas del deload son artificialmente bajas y no reflejan capacidad).
   * El RIR y la rampa de volumen arrancan de nuevo: así se encadenan bloques
   * según el modelo acumulación + deload + acumulación.
   */
  async createFollowUp(sourceId: string): Promise<MesocycleRow> {
    const db = getDb();
    const rules = getRules();
    const source = await db.mesocycles.get(sourceId);
    if (!source) throw new Error("Mesociclo origen no encontrado.");
    const settings = await settingsRepo.get();

    // Historial por ejercicio SIN deload (sesiones completadas).
    const sessions = await db.sessions.where("mesocycleId").equals(sourceId).toArray();
    const eligible = [
      ...sessions.filter((x) => x.status === "completed" && !x.isDeload).map((x) => x.id),
    ];
    const logs = await db.setLogs.where("sessionId").anyOf(eligible).toArray();
    const logsByExercise = new Map<string, SetLog[]>();
    for (const l of logs) {
      const arr = logsByExercise.get(l.exerciseId) ?? [];
      arr.push(l);
      logsByExercise.set(l.exerciseId, arr);
    }

    // Carga heredada por ejercicio: prescripción siguiente según el motor.
    const exercises = await exerciseRepo.byId();
    const overrides = new Map<string, number>();
    const week0 = source.plan.weeks.find((w) => !w.isDeload) ?? source.plan.weeks[0];
    for (const day of week0.days) {
      for (const slot of day.slots) {
        if (overrides.has(slot.exerciseId)) continue;
        const history = logsByExercise.get(slot.exerciseId) ?? [];
        if (history.length === 0) continue; // sin datos: conserva la carga del plan
        const bySession = groupBySession(history);
        const lastSession = bySession[bySession.length - 1];
        const lastLoad = Math.max(...lastSession.map((l) => l.actualLoadKg));
        const ex = exercises.get(slot.exerciseId);
        if (!ex) continue;
        const p = nextPrescription({
          exerciseHistory: history,
          model: source.progressionModel,
          targetRir: slot.targetRir,
          repRange: slot.repRange,
          currentLoadKg: lastLoad,
          equipmentType: ex.equipmentType,
          equipment: settings.equipment,
          dayType: slot.dayType,
          weekIndex: 0,
          numAccumulationWeeks: source.plan.numAccumulationWeeks,
          rules,
        });
        overrides.set(slot.exerciseId, p.nextLoadKg);
      }
    }

    const baseWeek = deriveBaseWeekFromPlan(source.plan, overrides);
    const match = source.name.match(/^(.*) · (\d+)$/);
    const name = match ? match[1] + " · " + (Number(match[2]) + 1) : source.name + " · 2";

    return mesocycleRepo.createFromBaseWeek({
      name,
      progressionModel: source.progressionModel,
      numAccumulationWeeks: source.plan.numAccumulationWeeks,
      baseWeekOverride: baseWeek,
      continuedFromId: sourceId,
    });
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
    await finalizeMesoIfDone(id);
  },
  async skip(id: string): Promise<void> {
    await getDb().sessions.update(id, { status: "skipped" });
    await finalizeMesoIfDone(id);
  },
};

/** Si no quedan sesiones pendientes en el meso de esta sesión, lo marca completado. */
async function finalizeMesoIfDone(sessionId: string): Promise<void> {
  const db = getDb();
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  const pending = await db.sessions
    .where("mesocycleId").equals(session.mesocycleId)
    .filter((x) => x.status === "pending")
    .count();
  if (pending === 0) {
    await db.mesocycles.update(session.mesocycleId, { status: "completed" });
  }
}

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
