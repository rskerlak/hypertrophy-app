// Repositories: única API con la que la UI/stores tocan la persistencia.
// La UI nunca llama a Dexie directo; pasa por aquí.

import type {
  BaseWeek,
  Checkin,
  DayIntensity,
  Exercise,
  MesocyclePlan,
  MesoIntent,
  ProgressionModel,
  RirBand,
  SetLog,
} from "@/domain/types";
import { getRules } from "@/lib/rulesLoader";
import { uuid } from "@/lib/id";
import { countExerciseInPlan, deriveBaseWeekFromPlan, generateMesocycle, replaceExerciseInPlan, swapExerciseInPlan } from "@/domain/mesocycle";
import { scheduleDates } from "@/domain/analytics";
import { CURRENT_BACKUP_VERSION, equipmentSchema, validateBackup } from "@/db/backupSchema";
import { groupBySession, nextPrescription } from "@/domain/progression";
import { trackHistory } from "@/domain/history";
import { suggestLoadFromHistory } from "@/domain/oneRepMax";
import { roundToAvailable } from "@/domain/rounding";
import { assessRirCalibration, calibratedRirCap } from "@/domain/rirCalibration";
import { addProfile, editActiveEquipment, removeProfile, renameProfile, switchProfile } from "@/lib/equipmentProfiles";
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
  } else {
    // A4.4: semanas guardadas antes de los ids de slot. Se migra acá (arranque)
    // y no en baseWeekRepo.get(): ese corre dentro de useLiveQuery (solo lectura).
    const { week, changed } = withSlotIds(bw);
    if (changed) await db.baseWeek.put({ ...week, id: "default" });
  }

  const count = await db.exercises.count();
  const seededVersion = settings?.seedVersion ?? 0;
  if (count === 0 || seededVersion < SEED_VERSION) {
    await db.transaction("rw", db.exercises, db.settings, async () => {
      // Preservar los ejercicios creados por el usuario al re-sembrar la biblioteca,
      // y los archivados (borrados con historial) siguen archivados.
      const custom = await db.exercises.filter((e) => e.custom === true).toArray();
      const archived = new Set((await db.exercises.filter((e) => e.archived === true).toArray()).map((e) => e.id));
      await db.exercises.clear();
      await db.exercises.bulkPut(seedExercises.map((e) => (archived.has(e.id) ? { ...e, archived: true } : e)));
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
    // A4.5: editar el inventario activo lo guarda también en su perfil.
    if (patch.equipment) {
      const ok = equipmentSchema.safeParse(patch.equipment);
      if (!ok.success) throw new Error(`Inventario inválido: ${ok.error.issues[0]?.message ?? "valor fuera de rango"}.`);
    }
    if (patch.equipment && !patch.equipmentProfiles) {
      const current = await settingsRepo.get();
      patch = { ...patch, ...editActiveEquipment(current, patch.equipment) };
    }
    await db.settings.update("default", patch);
  },
  async switchEquipmentProfile(id: string): Promise<void> {
    await getDb().settings.update("default", switchProfile(await settingsRepo.get(), id));
  },
  async addEquipmentProfile(name: string): Promise<void> {
    await getDb().settings.update("default", addProfile(await settingsRepo.get(), name, uuid()));
  },
  async renameEquipmentProfile(id: string, name: string): Promise<void> {
    await getDb().settings.update("default", renameProfile(await settingsRepo.get(), id, name));
  },
  async removeEquipmentProfile(id: string): Promise<void> {
    await getDb().settings.update("default", removeProfile(await settingsRepo.get(), id));
  },
};

// ---- Ejercicios ----

export const exerciseRepo = {
  /** Todos, incluidos los archivados (para resolver nombres del historial). */
  async all(): Promise<Exercise[]> {
    return getDb().exercises.toArray();
  },
  /** Los que se pueden elegir: sin archivados (listas, selectores, reemplazos). */
  async selectable(): Promise<Exercise[]> {
    return getDb().exercises.filter((e) => !e.archived).toArray();
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
   * Dónde se usa un ejercicio (A4.2): mesos no terminados cuyo plan lo tiene,
   * slots de la semana base y series registradas (historial).
   */
  async usage(id: string): Promise<{ mesos: Array<{ id: string; name: string; status: MesocycleRow["status"] }>; baseWeekSlots: number; loggedSets: number }> {
    const db = getDb();
    const [mesos, bw, loggedSets] = await Promise.all([
      db.mesocycles.toArray(),
      db.baseWeek.get("default"),
      db.setLogs.where("exerciseId").equals(id).count(),
    ]);
    return {
      mesos: mesos
        .filter((m) => m.status !== "completed" && countExerciseInPlan(m.plan, id) > 0)
        .map((m) => ({ id: m.id, name: m.name, status: m.status })),
      baseWeekSlots: bw ? bw.days.reduce((n, d) => n + d.slots.filter((s) => s.exerciseId === id).length, 0) : 0,
      loggedSets,
    };
  },

  /**
   * Reemplaza el ejercicio por otro en la semana base y en los planes de los
   * mesos no terminados, y después lo elimina. El historial (setLogs) se
   * conserva con su id: Stats y Excel lo muestran como "(ejercicio eliminado)".
   */
  async replaceAndRemove(id: string, replacementId: string): Promise<void> {
    const db = getDb();
    if (id === replacementId) throw new Error("El reemplazo debe ser otro ejercicio.");
    const loadFor = await loadEstimator(replacementId);
    await db.transaction("rw", [db.exercises, db.baseWeek, db.mesocycles, db.sessions, db.setLogs], async () => {
      if (!(await db.exercises.get(replacementId))) throw new Error("Ejercicio de reemplazo no encontrado.");
      const mesos = await db.mesocycles.filter((m) => m.status !== "completed").toArray();
      for (const m of mesos) {
        if (countExerciseInPlan(m.plan, id) === 0) continue;
        // Solo desde la primera semana con sesiones pendientes: lo entrenado no se reescribe (M4).
        const rows = await db.sessions.where("mesocycleId").equals(m.id).toArray();
        const pending = rows.filter((s) => s.status === "pending");
        const fromWeek = pending.length ? Math.min(...pending.map((s) => s.weekIndex)) : m.plan.weeks.length;
        const trained = new Set(rows.filter((s) => s.status !== "pending").map((s) => `${s.weekIndex}:${s.dayIndex}`));
        await db.mesocycles.update(m.id, {
          plan: replaceExerciseInPlan(
            m.plan,
            id,
            replacementId,
            fromWeek,
            (sl) => loadFor(sl.repRange.min, sl.targetRir, sl.targetLoadKg),
            (w, d) => trained.has(`${w}:${d}`),
          ),
        });
      }
      const bw = await db.baseWeek.get("default");
      if (bw) {
        await db.baseWeek.put({
          id: "default",
          days: bw.days.map((d) => ({
            ...d,
            slots: d.slots.map((s) =>
              s.exerciseId === id ? { ...s, exerciseId: replacementId, startingLoadKg: loadFor(s.repRange.min, undefined, s.startingLoadKg) } : s,
            ),
          })),
        });
      }
      await removeExerciseTx(id);
    });
  },

  /**
   * Elimina un ejercicio. Además lo quita de la semana base y de los
   * swapCandidates de otros ejercicios para no dejar referencias colgadas.
   * Si está en el plan de un meso no terminado, usar `replaceAndRemove`.
   */
  async remove(id: string): Promise<void> {
    const db = getDb();
    await db.transaction("rw", [db.exercises, db.baseWeek, db.setLogs], () => removeExerciseTx(id));
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

/**
 * Borrado de un ejercicio dentro de una transacción ya abierta (exercises,
 * baseWeek, setLogs). Con historial se ARCHIVA (auditoría M4): el historial
 * conserva nombre, músculos y volumen. Sin historial se borra.
 */
async function removeExerciseTx(id: string): Promise<void> {
  const db = getDb();
  const logged = await db.setLogs.where("exerciseId").equals(id).count();
  if (logged > 0) await db.exercises.update(id, { archived: true, swapCandidates: [] });
  else await db.exercises.delete(id);
  const others = await db.exercises.filter((e) => e.swapCandidates.includes(id)).toArray();
  for (const o of others) await db.exercises.update(o.id, { swapCandidates: o.swapCandidates.filter((c) => c !== id) });
  const bw = await db.baseWeek.get("default");
  if (bw) {
    await db.baseWeek.put({ id: "default", days: bw.days.map((d) => ({ ...d, slots: d.slots.filter((s) => s.exerciseId !== id) })) });
  }
}

/**
 * Estimador de carga para un ejercicio que entra en lugar de otro (auditoría M3):
 * con historial real (sin deload), Epley invertido para el piso del rango al RIR
 * objetivo; sin historial, la carga inicial por defecto del config redondeada;
 * en peso corporal, 0. Nunca hereda la carga del ejercicio anterior.
 */
export async function loadEstimator(
  exerciseId: string,
  excludeSessionId?: string,
): Promise<(repMin: number, targetRir: number | undefined, previousLoadKg: number) => number> {
  const db = getDb();
  const rules = getRules();
  const [ex, settings] = await Promise.all([db.exercises.get(exerciseId), settingsRepo.get()]);
  const history = ex && ex.equipmentType !== "bodyweight" ? await setLogRepo.completedNonDeloadForExercise(exerciseId, excludeSessionId) : [];
  return (repMin, targetRir, previousLoadKg) => {
    if (!ex || ex.equipmentType === "bodyweight" || previousLoadKg === 0) return 0;
    const ctx = { type: ex.equipmentType, equipment: settings.equipment };
    const fromHistory = suggestLoadFromHistory({
      history,
      targetReps: repMin,
      targetRir: targetRir ?? rules.dayIntensity.startingLoadReferenceRir,
      rules,
      ctx,
    });
    return fromHistory ?? roundToAvailable(rules.baseWeekDefaults.startingLoadKg, ctx);
  };
}

/** Asigna id a los slots que no lo tienen (o lo tienen provisorio). Devuelve si cambió algo. */
function withSlotIds(bw: BaseWeek): { week: BaseWeek; changed: boolean } {
  let changed = false;
  const days = bw.days.map((d) => ({
    ...d,
    slots: d.slots.map((s) => {
      if (s.id && !s.id.startsWith("tmp-")) return s;
      changed = true;
      return { ...s, id: uuid() };
    }),
  }));
  return { week: { ...bw, days }, changed };
}

export const baseWeekRepo = {
  /**
   * Solo lectura (se usa dentro de useLiveQuery: no puede escribir). Si algún
   * slot no tiene id todavía, se le da uno determinista en memoria; el real lo
   * asigna `set` o la migración de `ensureSeeded`.
   */
  async get(): Promise<BaseWeek> {
    const bw = await getDb().baseWeek.get("default");
    if (!bw) return { days: [] };
    return {
      ...bw,
      days: bw.days.map((d, di) => ({ ...d, slots: d.slots.map((s, si) => (s.id ? s : { ...s, id: `tmp-${di}-${si}` })) })),
    };
  },
  async set(baseWeek: BaseWeek): Promise<void> {
    const { id: _ignored, ...rest } = baseWeek as BaseWeek & { id?: string };
    void _ignored;
    await getDb().baseWeek.put({ ...withSlotIds(rest).week, id: "default" });
  },

  /**
   * Carga inicial sugerida para un ejercicio nuevo en la semana base (A4.4):
   * desde el 1RM de tu última sesión real (sin deload) para el piso del rango,
   * al RIR de referencia + offset del día. null sin historial o en peso corporal.
   */
  async suggestStartingLoad(exerciseId: string, repMin: number, intensity?: DayIntensity): Promise<number | null> {
    const db = getDb();
    const rules = getRules();
    const [settings, ex] = await Promise.all([settingsRepo.get(), db.exercises.get(exerciseId)]);
    if (!ex || ex.equipmentType === "bodyweight") return null;
    const sessions = await db.sessions.where("status").equals("completed").toArray();
    const ok = new Set(sessions.filter((x) => !x.isDeload).map((x) => x.id));
    const history = (await db.setLogs.where("exerciseId").equals(exerciseId).toArray()).filter((l) => ok.has(l.sessionId));
    const offset = intensity ? rules.dayIntensity[intensity].rirOffset : 0;
    return suggestLoadFromHistory({
      history,
      targetReps: repMin,
      targetRir: Math.max(0, rules.dayIntensity.startingLoadReferenceRir + offset),
      rules,
      ctx: { type: ex.equipmentType, equipment: settings.equipment },
    });
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
    /** Intención declarada (A5.3); sin valor = hipertrofia. */
    intent?: MesoIntent;
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
      ...(args.intent && args.intent !== "hypertrophy" ? { intent: args.intent } : {}),
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

  /** Cambia la intención declarada (A5.3). Solo la usa la memoria larga. */
  async setIntent(id: string, intent: MesoIntent): Promise<void> {
    await getDb().mesocycles.update(id, { intent });
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
    await db.transaction("rw", db.sessions, db.settings, async () => {
      const rows = (await db.sessions.where("mesocycleId").equals(id).toArray()).sort(
        (a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex,
      );
      const pending = rows.filter((s) => s.status === "pending");
      const dates = scheduleDates(pending.length, startIso, weekdays);
      for (let i = 0; i < pending.length; i++) await db.sessions.update(pending[i].id, { plannedDate: dates[i] });
      await db.settings.update("default", { trainingWeekdays: [...weekdays].sort() });
    });
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
    const loadFor = await loadEstimator(exerciseId);
    await db.mesocycles.update(id, {
      plan: swapExerciseInPlan(meso.plan, dayIndex, slotIndex, exerciseId, fromWeekIndex, (sl) => loadFor(sl.repRange.min, sl.targetRir, sl.targetLoadKg)),
    });
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

    // Calibración del RIR con el meso origen (sin deload, completadas).
    const sessions = await db.sessions.where("mesocycleId").equals(sourceId).toArray();
    const eligible = [
      ...sessions.filter((x) => x.status === "completed" && !x.isDeload).map((x) => x.id),
    ];
    const logs = await db.setLogs.where("sessionId").anyOf(eligible).toArray();
    const calibration = assessRirCalibration(logs, rules);
    // Historial de cada pista: el mismo que usa la sesión (A5.1), que cruza mesos.
    const allMesos = await db.mesocycles.toArray();
    const mesoRefs = new Map(
      allMesos.map((m) => [m.id, { plan: m.plan, progressionModel: m.progressionModel, numAccumulationWeeks: m.numAccumulationWeeks }]),
    );
    const today = new Date().toISOString();
    const tracks = new Map<string, { logs: SetLog[]; sessions: SessionRow[] }>();
    for (const exerciseId of new Set(source.plan.weeks.flatMap((w) => w.days.flatMap((d) => d.slots.map((x) => x.exerciseId))))) {
      const exLogs = await db.setLogs.where("exerciseId").equals(exerciseId).toArray();
      const exSessions = await db.sessions.bulkGet([...new Set(exLogs.map((l) => l.sessionId))]);
      tracks.set(exerciseId, { logs: exLogs, sessions: exSessions.filter((x): x is SessionRow => !!x) });
    }

    // Carga heredada POR SLOT: prescripción siguiente del motor usando solo el
    // historial de la misma pista (un ejercicio en día fuerte y en día liviano
    // hereda cargas distintas).
    const exercises = await exerciseRepo.byId();
    const overrides = new Map<string, number>();
    const week0 = source.plan.weeks.find((w) => !w.isDeload) ?? source.plan.weeks[0];
    week0.days.forEach((day, dayIndex) => {
      day.slots.forEach((slot, slotIndex) => {
        const data = tracks.get(slot.exerciseId);
        if (!data) return;
        // Después de todo el meso origen (todas sus sesiones son anteriores).
        const r = trackHistory({
          logs: data.logs,
          sessions: data.sessions,
          mesos: mesoRefs,
          current: { mesocycleId: sourceId, weekIndex: source.plan.weeks.length, dayIndex: 0, slotIndex, slot, intensity: day.intensity },
          today,
          rules,
        });
        const history = r.history;
        const anchor =
          r.anchor && (r.continuity === "track-changed" || r.continuity === "gap")
            ? { logs: r.anchor, reason: r.continuity, ageDays: r.anchorAgeDays }
            : undefined;
        if (history.length === 0 && !anchor) return; // sin datos: conserva la carga del plan
        const ex = exercises.get(slot.exerciseId);
        if (!ex) return;
        const bySession = groupBySession(history);
        const lastSession = bySession[bySession.length - 1];
        const lastLoad = lastSession ? Math.max(...lastSession.map((l) => l.actualLoadKg)) : slot.targetLoadKg;
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
          historyWeekIndex: r.last?.weekIndex,
          historyNumAccumulationWeeks: r.last ? mesoRefs.get(r.last.mesocycleId)?.numAccumulationWeeks : undefined,
          numAccumulationWeeks: source.plan.numAccumulationWeeks,
          anchor,
          // Mismos parámetros que la sesión (auditoría M5): APRE y confianza en el RIR.
          slotProgression: slot.progression,
          rirCapOverride: calibratedRirCap(rules.progressionModels.double.rirAdjustmentCapReps, calibration, rules),
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
      intent: source.intent,
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
  /** Sesiones pendientes de un meso (aviso al pausarlo, A4.4). */
  async pendingCount(mesocycleId: string): Promise<number> {
    return getDb().sessions.where("mesocycleId").equals(mesocycleId).filter((s) => s.status === "pending").count();
  },

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
  /** 1 = hasta A3; 2 = desde A4.1 (mismos campos, validado por fila). Se importan ambas. */
  backupVersion: number;
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
      backupVersion: CURRENT_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: { settings, baseWeek, exercises, mesocycles, sessions, setLogs, checkins, measurements, activities, bugReports },
    };
  },

  /**
   * Reemplaza TODOS los datos locales con el contenido del respaldo (A4.1).
   * Valida cada fila con Zod ANTES de borrar nada: si algo falla, lanza un
   * error que nombra tabla, fila y campo, y la base queda intacta.
   */
  async import(raw: unknown): Promise<void> {
    const v = validateBackup(raw);
    if (!v.ok) throw new Error(v.error);
    // Se importa la SALIDA validada (no el JSON crudo): Zod descarta claves como
    // __proto__ y deja solo filas que pasaron los tipos y topes (auditoría S-01/S-07).
    const d = v.backup.data as unknown as BackupFile["data"];
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
