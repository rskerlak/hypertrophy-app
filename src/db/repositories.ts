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
import { getDb, type MesocycleRow, type SessionRow, type SettingsRow } from "./schema";
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
      await db.exercises.clear();
      await db.exercises.bulkPut(seedExercises);
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
