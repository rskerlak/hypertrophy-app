// Repositories: única API con la que la UI/stores tocan la persistencia.
// La UI nunca llama a Dexie directo; pasa por aquí.

import type {
  BaseWeek,
  Checkin,
  Exercise,
  MesocyclePlan,
  ProgressionModel,
  RirBand,
  SetLog,
} from "@/domain/types";
import { getRules } from "@/lib/rulesLoader";
import { uuid } from "@/lib/id";
import { deriveBaseWeekFromPlan, generateMesocycle, swapExerciseInPlan } from "@/domain/mesocycle";
import { scheduleDates } from "@/domain/analytics";
import { groupBySession, nextPrescription, sameProgressionTrack } from "@/domain/progression";
import { suggestLoadFromHistory } from "@/domain/oneRepMax";
import { z } from "zod";
import { getDb, type ActivityRow, type BaseWeekRow, type BugReportRow, type MeasurementRow, type MesocycleRow, type SessionRow, type SettingsRow } from "./schema";
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
  /** Nota persistente y/o descanso propio de un ejercicio (también de biblioteca). */
  async setNoteAndRest(id: string, changes: { note?: string; restSec?: number | null }): Promise<void> {
    const update: Partial<Exercise> = {};
    if (changes.note !== undefined) update.note = changes.note.trim() || undefined;
    if (changes.restSec !== undefined) update.restSec = changes.restSec ?? undefined;
    await getDb().exercises.update(id, update);
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

  /**
   * Reemplaza la semana base por una rutina precargada. Las cargas iniciales
   * NO quedan las fijas de la plantilla: para cada ejercicio con historial se
   * estiman desde el 1RM de tu última sesión real (sin deloads) para el piso
   * del rango, al RIR de referencia del config + el offset del día. Así el día
   * fuerte arranca más pesado y el liviano más liviano. Sin historial (o en
   * modo peso corporal, carga 0) se conserva la carga de la plantilla.
   */
  async applyTemplate(days: BaseWeek["days"]): Promise<{ estimated: number; kept: number }> {
    const db = getDb();
    const rules = getRules();
    const [settings, exercises, sessions] = await Promise.all([
      settingsRepo.get(),
      exerciseRepo.byId(),
      db.sessions.where("status").equals("completed").toArray(),
    ]);
    const okSessions = new Set(sessions.filter((x) => !x.isDeload).map((x) => x.id));
    let estimated = 0;
    let kept = 0;
    const out: BaseWeek["days"] = [];
    for (const day of days) {
      const offset = day.intensity ? rules.dayIntensity[day.intensity].rirOffset : 0;
      const refRir = Math.max(0, rules.dayIntensity.startingLoadReferenceRir + offset);
      const slots = [];
      for (const slot of day.slots) {
        const ex = exercises.get(slot.exerciseId);
        let load = slot.startingLoadKg;
        if (ex && slot.startingLoadKg > 0 && ex.equipmentType !== "bodyweight") {
          const history = (await db.setLogs.where("exerciseId").equals(slot.exerciseId).toArray()).filter((l) =>
            okSessions.has(l.sessionId),
          );
          const suggested = suggestLoadFromHistory({
            history,
            targetReps: slot.repRange.min,
            targetRir: refRir,
            rules,
            ctx: { type: ex.equipmentType, equipment: settings.equipment },
          });
          if (suggested !== null) {
            load = suggested;
            estimated++;
          } else kept++;
        } else kept++;
        slots.push({ ...slot, repRange: { ...slot.repRange }, startingLoadKg: load });
      }
      out.push({ ...day, slots });
    }
    await baseWeekRepo.set({ days: out });
    return { estimated, kept };
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
    /** Banda de RIR del meso (ej. 1–3). Sin valor: calendario del config. */
    rirBand?: RirBand;
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
      rirBand: args.rirBand,
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

  /**
   * Regenera el plan del meso con el motor/config ACTUAL. Las sesiones y series
   * ya registradas no se tocan: solo cambian los targets de lo que falta.
   *
   * De dónde toma la estructura: si la semana base guardada tiene la MISMA
   * cantidad de días que el plan (o sea, el usuario la editó pero no cambió el
   * esqueleto), se usa esa — así los cambios de rango de reps, series y cargas
   * hechos en Plan llegan al meso activo. Si el esqueleto cambió (agregó o
   * quitó días), se cae a la semana 1 del plan viejo, porque las sesiones ya
   * creadas están indexadas por día y quedarían descolgadas.
   */
  async regeneratePlan(id: string): Promise<{ usedBaseWeek: boolean }> {
    const db = getDb();
    const rules = getRules();
    const meso = await db.mesocycles.get(id);
    if (!meso) throw new Error("Mesociclo no encontrado.");
    const [settings, exercises, savedBaseWeek] = await Promise.all([
      settingsRepo.get(),
      exerciseRepo.all(),
      baseWeekRepo.get(),
    ]);
    const planDays = (meso.plan.weeks.find((w) => !w.isDeload) ?? meso.plan.weeks[0]).days.length;
    const usedBaseWeek =
      savedBaseWeek.days.length === planDays &&
      savedBaseWeek.days.some((d) => d.slots.length > 0);
    const plan = generateMesocycle({
      baseWeek: usedBaseWeek ? savedBaseWeek : deriveBaseWeekFromPlan(meso.plan),
      exercises,
      profile: settings.experienceProfile,
      progressionModel: meso.progressionModel,
      numAccumulationWeeks: meso.numAccumulationWeeks,
      prioritizedMuscles: settings.prioritizedMuscles,
      rules,
      rirBand: meso.plan.rirBand,
    });
    await db.mesocycles.update(id, { plan });
    return { usedBaseWeek };
  },

  /**
   * Agenda (A3.2): asigna fechas a las sesiones PENDIENTES en orden desde
   * `startIso`, solo en los días de entrenamiento elegidos. Las completadas y
   * saltadas conservan su fecha. Solo agenda: la progresión no depende de esto.
   */
  async schedule(id: string, startIso: string, weekdays: number[]): Promise<void> {
    const db = getDb();
    const rows = (await db.sessions.where("mesocycleId").equals(id).toArray()).sort(
      (a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex,
    );
    const pending = rows.filter((s) => s.status === "pending");
    const dates = scheduleDates(pending.length, startIso, weekdays);
    await db.transaction("rw", db.sessions, async () => {
      for (let i = 0; i < pending.length; i++) await db.sessions.update(pending[i].id, { plannedDate: dates[i] });
    });
    await settingsRepo.update({ trainingWeekdays: [...weekdays].sort() });
  },

  /**
   * Descargar ahora (A1.8): salta las sesiones de ACUMULACIÓN pendientes para
   * que la próxima sea la semana de deload. Reversible: cada sesión saltada
   * puede reabrirse. Devuelve cuántas se saltaron.
   */
  async startDeloadNow(id: string): Promise<number> {
    const db = getDb();
    const rows = await db.sessions.where("mesocycleId").equals(id).toArray();
    const toSkip = rows.filter((s) => s.status === "pending" && !s.isDeload && !s.startedAt);
    await db.transaction("rw", db.sessions, async () => {
      for (const s of toSkip) await db.sessions.update(s.id, { status: "skipped" });
    });
    return toSkip.length;
  },

  /**
   * Swap "en el plan" (A1.6/A1.9): cambia el ejercicio del slot desde la
   * semana indicada en adelante. La semana base guardada no cambia (puede
   * tener otra estructura que el meso activo).
   */
  async swapExerciseInPlan(id: string, dayIndex: number, slotIndex: number, exerciseId: string, fromWeekIndex: number): Promise<void> {
    const db = getDb();
    const meso = await db.mesocycles.get(id);
    if (!meso) throw new Error("Mesociclo no encontrado.");
    await db.mesocycles.update(id, { plan: swapExerciseInPlan(meso.plan, dayIndex, slotIndex, exerciseId, fromWeekIndex) });
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
    const sessionById = new Map(sessions.map((x) => [x.id, x]));

    // Carga heredada POR SLOT: prescripción siguiente del motor usando solo el
    // historial de la misma pista (un ejercicio en día fuerte y en día liviano
    // hereda cargas distintas).
    const exercises = await exerciseRepo.byId();
    const overrides = new Map<string, number>();
    const week0 = source.plan.weeks.find((w) => !w.isDeload) ?? source.plan.weeks[0];
    week0.days.forEach((day, dayIndex) => {
      day.slots.forEach((slot, slotIndex) => {
        const current = { slot, intensity: day.intensity };
        const history = logs.filter((l) => {
          if (l.exerciseId !== slot.exerciseId) return false;
          const sess = sessionById.get(l.sessionId);
          const pday = sess ? source.plan.weeks[sess.weekIndex]?.days[sess.dayIndex] : undefined;
          const pslot = pday?.slots.find((x) => x.exerciseId === slot.exerciseId);
          return !!pday && !!pslot && sameProgressionTrack(current, { slot: pslot, intensity: pday.intensity }, source.progressionModel);
        });
        if (history.length === 0) return; // sin datos: conserva la carga del plan
        const ex = exercises.get(slot.exerciseId);
        if (!ex) return;
        const bySession = groupBySession(history);
        const lastSession = bySession[bySession.length - 1];
        const lastLoad = Math.max(...lastSession.map((l) => l.actualLoadKg));
        const p = nextPrescription({
          exerciseHistory: history,
          model: source.progressionModel,
          targetRir: slot.targetRir,
          repRange: slot.repRange,
          currentLoadKg: lastLoad,
          equipmentType: slot.targetLoadKg === 0 ? "bodyweight" : ex.equipmentType,
          equipment: settings.equipment,
          dayType: slot.dayType,
          weekIndex: 0,
          numAccumulationWeeks: source.plan.numAccumulationWeeks,
          rules,
        });
        overrides.set(`${dayIndex}:${slotIndex}`, slot.targetLoadKg === 0 ? 0 : p.nextLoadKg);
      });
    });

    const baseWeek = deriveBaseWeekFromPlan(source.plan, overrides);
    const match = source.name.match(/^(.*) · (\d+)$/);
    const name = match ? match[1] + " · " + (Number(match[2]) + 1) : source.name + " · 2";

    return mesocycleRepo.createFromBaseWeek({
      name,
      progressionModel: source.progressionModel,
      numAccumulationWeeks: source.plan.numAccumulationWeeks,
      baseWeekOverride: baseWeek,
      continuedFromId: sourceId,
      rirBand: source.plan.rirBand,
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

  /**
   * Vuelve una sesión completada o saltada a "pendiente" (A1.6). Sus series
   * registradas se conservan. Si el meso se había cerrado por esta sesión,
   * vuelve a activo (pausando el que estuviera activo).
   */
  async reopen(id: string): Promise<void> {
    const db = getDb();
    const s = await db.sessions.get(id);
    if (!s) throw new Error("Sesión no encontrada.");
    await db.sessions.update(id, { status: "pending", completedAt: undefined });
    const meso = await db.mesocycles.get(s.mesocycleId);
    if (meso && meso.status !== "active") await mesocycleRepo.activate(meso.id);
  },

  /** Marca actividad: primera serie = inicio de la sesión; siempre, última serie. */
  async touch(id: string, nowIso: string): Promise<void> {
    const db = getDb();
    const s = await db.sessions.get(id);
    if (!s) return;
    await db.sessions.update(id, { startedAt: s.startedAt ?? nowIso, lastSetAt: nowIso });
  },

  async byIds(ids: string[]): Promise<SessionRow[]> {
    return (await getDb().sessions.bulkGet(ids)).filter((s): s is SessionRow => !!s);
  },

  /** Sesión empezada y sin finalizar del meso activo (para "Continuar" en Home). */
  async inProgress(): Promise<SessionRow | undefined> {
    const db = getDb();
    const active = await db.mesocycles.where("status").equals("active").first();
    if (!active) return undefined;
    const rows = await db.sessions.where("mesocycleId").equals(active.id).toArray();
    return rows.find((s) => s.status === "pending" && !!s.startedAt);
  },

  /** Reemplaza el ejercicio de un slot SOLO en esta sesión (null = volver al del plan). */
  async swapExerciseToday(id: string, slotIndex: number, exerciseId: string | null): Promise<void> {
    const db = getDb();
    const s = await db.sessions.get(id);
    if (!s) return;
    const prev = (s.overrides?.exercise ?? []).filter((x) => x.slotIndex !== slotIndex);
    const exercise = exerciseId ? [...prev, { slotIndex, exerciseId }] : prev;
    await db.sessions.update(id, { overrides: { ...s.overrides, exercise } });
  },

  /**
   * Aplica un deload por ejercicio (A2.3) a la PRÓXIMA sesión pendiente del
   * mismo día del split: series y carga del slot por los factores dados.
   * Devuelve la sesión afectada o null si no hay otra pendiente de ese día.
   */
  async applyExerciseDeloadToNext(
    sessionId: string,
    slotIndex: number,
    setsFactor: number,
    loadFactor: number,
  ): Promise<SessionRow | null> {
    const db = getDb();
    const s = await db.sessions.get(sessionId);
    if (!s) return null;
    const rows = (await db.sessions.where("mesocycleId").equals(s.mesocycleId).toArray())
      .filter((x) => x.status === "pending" && !x.isDeload && x.dayIndex === s.dayIndex)
      .sort((a, b) => a.weekIndex - b.weekIndex);
    const next = rows[0];
    if (!next) return null;
    const list = (next.overrides?.exerciseDeload ?? []).filter((x) => x.slotIndex !== slotIndex);
    await db.sessions.update(next.id, {
      overrides: { ...next.overrides, exerciseDeload: [...list, { slotIndex, setsFactor, loadFactor }] },
    });
    return next;
  },

  /** Suma o resta series SOLO en esta sesión (el plan no cambia). */
  async changeSetsToday(id: string, slotIndex: number, delta: number): Promise<void> {
    const db = getDb();
    const s = await db.sessions.get(id);
    if (!s) return;
    const list = s.overrides?.setsDelta ?? [];
    const cur = list.find((x) => x.slotIndex === slotIndex)?.delta ?? 0;
    const next = cur + delta;
    const setsDelta = [...list.filter((x) => x.slotIndex !== slotIndex), ...(next !== 0 ? [{ slotIndex, delta: next }] : [])];
    await db.sessions.update(id, { overrides: { ...s.overrides, setsDelta } });
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
  /**
   * Series de un ejercicio en sesiones COMPLETADAS fuera de deload (todos los
   * mesos), excluyendo una sesión. Base para récords personales.
   */
  async completedNonDeloadForExercise(exerciseId: string, excludeSessionId?: string): Promise<SetLog[]> {
    const db = getDb();
    const logs = await db.setLogs.where("exerciseId").equals(exerciseId).toArray();
    const ids = [...new Set(logs.map((l) => l.sessionId))].filter((x) => x !== excludeSessionId);
    const sessions = await db.sessions.bulkGet(ids);
    const ok = new Set(sessions.filter((s) => s && s.status === "completed" && !s.isDeload).map((s) => s!.id));
    return logs.filter((l) => ok.has(l.sessionId));
  },
  /** Actualiza nota/tipo/lado de una serie ya registrada. */
  async patch(id: string, changes: Partial<Pick<SetLog, "note" | "kind" | "side">>): Promise<void> {
    await getDb().setLogs.update(id, changes);
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

// ---- Bugs anotados por el usuario ----

const bugReportInput = z.object({
  text: z.string().trim().min(3, "Describí el bug en al menos 3 caracteres.").max(2000),
  category: z.enum(["engine", "ui", "data", "other"]),
  route: z.string().max(500),
  buildSha: z.string().max(40),
  context: z.object({
    viewport: z.string().optional(),
    visualViewport: z.string().optional(),
    standalone: z.boolean().optional(),
    userAgent: z.string().max(400).optional(),
  }),
});
export type BugReportInput = z.input<typeof bugReportInput>;

export const bugReportRepo = {
  async all(): Promise<BugReportRow[]> {
    return getDb().bugReports.orderBy("createdAt").reverse().toArray();
  },
  /**
   * Valida y guarda un bug, enriqueciendo el contexto con el meso activo y,
   * si la ruta es una sesión, con su semana y día (para reproducirlo).
   */
  async add(raw: BugReportInput): Promise<BugReportRow> {
    const input = bugReportInput.parse(raw);
    const db = getDb();
    const active = await db.mesocycles.where("status").equals("active").first();
    const sessionId = new URLSearchParams(input.route.split("?")[1] ?? "").get("id") ?? undefined;
    const session =
      input.route.startsWith("/session") && sessionId ? await db.sessions.get(sessionId) : undefined;
    const row: BugReportRow = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      status: "open",
      category: input.category,
      text: input.text,
      route: input.route,
      buildSha: input.buildSha,
      context: {
        ...input.context,
        activeMesocycleId: active?.id,
        activeMesocycleName: active?.name,
        sessionId: session?.id,
        sessionWeekIndex: session?.weekIndex,
        sessionDayLabel: session?.dayLabel,
      },
    };
    await db.bugReports.put(row);
    return row;
  },
  async setStatus(id: string, status: BugReportRow["status"]): Promise<void> {
    await getDb().bugReports.update(id, { status });
  },
  async remove(id: string): Promise<void> {
    await getDb().bugReports.delete(id);
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
    bugReports?: BugReportRow[];
  };
}

export const backupRepo = {
  /** Serializa TODA la base local a un objeto de respaldo. */
  async export(): Promise<BackupFile> {
    const db = getDb();
    const [settings, baseWeek, exercises, mesocycles, sessions, setLogs, checkins, measurements, activities, bugReports] =
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
        db.bugReports.toArray(),
      ]);
    return {
      app: "hypertrophy",
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      data: { settings, baseWeek, exercises, mesocycles, sessions, setLogs, checkins, measurements, activities, bugReports },
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
      [db.settings, db.baseWeek, db.exercises, db.mesocycles, db.sessions, db.setLogs, db.checkins, db.measurements, db.activities, db.bugReports],
      async () => {
        await Promise.all([
          db.settings.clear(), db.baseWeek.clear(), db.exercises.clear(),
          db.mesocycles.clear(), db.sessions.clear(), db.setLogs.clear(), db.checkins.clear(),
          db.measurements.clear(), db.activities.clear(), db.bugReports.clear(),
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
        if (Array.isArray(d.bugReports)) await db.bugReports.bulkPut(d.bugReports);
      },
    );
  },
};
