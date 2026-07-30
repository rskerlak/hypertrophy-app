// Cuando un músculo pasa su volumen aconsejable, decidir QUÉ conservar y qué
// es prescindible. Función pura, determinista.
//
// Criterio de prioridad (mayor = se conserva primero), por músculo:
//   1. Aporte DIRECTO (el músculo es primario del ejercicio) antes que
//      indirecto (sinergista): el indirecto ya viene "gratis" de otro patrón.
//   2. Perfil de resistencia, prefiriendo la posición ESTIRADA. Kassiano 2022
//      (JSCR): el criterio para variar debe ser anatómico/biomecánico (perfil,
//      longitud muscular), no variedad por sí misma, y un estímulo REDUNDANTE
//      puede ser hasta contraproducente → los duplicados del mismo perfil se
//      recortan primero. Maeo 2022 (tríceps overhead 1.4–1.5× vs neutro a igual
//      volumen) y Pedrosa 2022 (parciales a longitud larga > ROM completo en
//      varias regiones) sostienen preferir longitudes largas.
//      OJO: la posición ACORTADA no recibe slot protegido — Pedrosa halló que
//      el parcial corto no se distinguió del control en varias regiones, y un
//      ensayo 2025 en flexores de codo no encontró ventaja de MEZCLAR perfiles
//      frente a consolidar todo en longitud larga. Cubrir estirado/medio sí;
//      coleccionar perfiles, no.
//   3. Antes en la sesión y antes en la semana: menos fatiga acumulada.
//   4. Multiarticular antes que aislamiento, a igualdad del resto.
// Los primeros slots que cubren el objetivo son "anclas"; el resto es
// "recortable" — señal para el usuario, la app NUNCA borra nada sola.

import type { Rules } from "./rules";
import { effectiveLandmarks } from "./rules";
import type { BaseWeek, Exercise, ExperienceProfileId, ResistanceProfile } from "./types";

export interface SlotRef {
  dayIndex: number;
  slotIndex: number;
}

export type TrimRole = "anchor" | "trim";

export interface TrimDecision extends SlotRef {
  exerciseId: string;
  muscle: string;
  role: TrimRole;
  /** true si el músculo es el PRIMARIO del ejercicio (aporte directo). */
  direct: boolean;
  /** Series fraccionadas que aporta este slot al músculo. */
  contribution: number;
  reason: string;
}

export interface VolumeTrimResult {
  /** Por músculo excedido: nivel y volumen actual vs objetivo. */
  muscles: Array<{
    muscle: string;
    level: "mav" | "mrv";
    current: number;
    target: number;
  }>;
  /** Decisiones por slot; solo incluye slots de músculos excedidos. */
  decisions: TrimDecision[];
}

const PROFILE_RANK: Record<ResistanceProfile, number> = {
  stretch: 0, // cubrir primero la posición estirada
  mid: 1,
  short: 2,
};

interface Candidate extends SlotRef {
  exercise: Exercise;
  direct: boolean;
  contribution: number;
  order: number;
}

/**
 * Marca anclas y slots recortables para cada músculo cuyo volumen semanal
 * supere MAV (o MRV). El objetivo de recorte es MAV: es la referencia de
 * "rendimientos decrecientes" del config, no un límite duro medido.
 */
export function suggestVolumeTrim(input: {
  baseWeek: BaseWeek;
  exercisesById: Map<string, Exercise>;
  volumeByMuscle: Record<string, number>;
  profile: ExperienceProfileId;
  rules: Rules;
}): VolumeTrimResult {
  const { baseWeek, exercisesById, volumeByMuscle, profile, rules } = input;
  const direct = rules.volumeCounting.directSetWeight;
  const syn = rules.volumeCounting.synergistSetWeight;

  const muscles: VolumeTrimResult["muscles"] = [];
  const decisions: TrimDecision[] = [];

  for (const [muscle, current] of Object.entries(volumeByMuscle)) {
    if (current <= 0) continue;
    let lm;
    try {
      lm = effectiveLandmarks(rules, profile, muscle);
    } catch {
      continue; // músculo sin landmarks: no opinar
    }
    if (current <= lm.mav) continue;

    const level: "mav" | "mrv" = current > lm.mrv ? "mrv" : "mav";
    muscles.push({ muscle, level, current, target: lm.mav });

    // Candidatos: todo slot que aporte a este músculo.
    const candidates: Candidate[] = [];
    let order = 0;
    baseWeek.days.forEach((day, dayIndex) => {
      day.slots.forEach((slot, slotIndex) => {
        const ex = exercisesById.get(slot.exerciseId);
        if (!ex) return;
        order++;
        const isPrimary = ex.primaryMuscle === muscle;
        const isSynergist = ex.secondaryMuscles.includes(muscle);
        if (!isPrimary && !isSynergist) return;
        candidates.push({
          dayIndex,
          slotIndex,
          exercise: ex,
          direct: isPrimary,
          contribution: slot.targetSets * (isPrimary ? direct : syn),
          order,
        });
      });
    });

    // Orden de conservación. El perfil se decide en la pasada (los perfiles ya
    // cubiertos pierden prioridad), así que primero ordenamos por lo estable.
    candidates.sort(
      (a, b) =>
        Number(b.direct) - Number(a.direct) ||
        PROFILE_RANK[a.exercise.resistanceProfile] - PROFILE_RANK[b.exercise.resistanceProfile] ||
        compoundRank(a.exercise) - compoundRank(b.exercise) ||
        a.order - b.order,
    );

    const seenProfiles = new Set<ResistanceProfile>();
    let kept = 0;
    for (const c of candidates) {
      const profile = c.exercise.resistanceProfile;
      // Solo estirado y medio ganan slot protegido: el trabajo en posición
      // acortada no está respaldado como estímulo insustituible.
      const profileNew = !seenProfiles.has(profile) && profile !== "short";
      const keep = kept < lm.mav || (profileNew && c.direct);
      if (keep) {
        seenProfiles.add(profile);
        kept += c.contribution;
        decisions.push({
          dayIndex: c.dayIndex,
          slotIndex: c.slotIndex,
          exerciseId: c.exercise.id,
          muscle,
          role: "anchor",
          direct: c.direct,
          contribution: round1(c.contribution),
          reason: profileNew
            ? `Ancla: ${c.direct ? "aporte directo" : "sinergista"} y cubre el perfil ${profile === "stretch" ? "en estiramiento" : "medio"}.`
            : "Ancla: entra dentro del volumen aconsejable.",
        });
      } else {
        decisions.push({
          dayIndex: c.dayIndex,
          slotIndex: c.slotIndex,
          exerciseId: c.exercise.id,
          muscle,
          role: "trim",
          direct: c.direct,
          contribution: round1(c.contribution),
          reason: c.direct
            ? profile === "short"
              ? `Prescindible: trabaja en posición acortada (el estímulo menos respaldado) y el volumen de ${muscle} ya está cubierto.`
              : `Prescindible: el volumen aconsejable de ${muscle} ya está cubierto por ejercicios con este mismo perfil.`
            : `Prescindible para ${muscle}: aporta de forma indirecta (sinergista) y el volumen ya está cubierto.`,
        });
      }
    }
  }

  return { muscles, decisions };
}

/** Multiarticular (tiene sinergistas) antes que aislamiento puro. */
function compoundRank(ex: Exercise): number {
  return ex.secondaryMuscles.length > 0 ? 0 : 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Resumen por slot para la UI. Dos reglas para que el marcado sea accionable:
 *  - Solo se marca "recortable" por exceso en el músculo PRIMARIO del ejercicio.
 *    Un exceso que viene del aporte sinergista no se arregla sacando ese
 *    ejercicio (perderías su trabajo directo): se arregla bajando series o
 *    aceptándolo. Sin esta regla, un press de piernas aparecía "prescindible"
 *    porque sobraban glúteos, cuando es el ejercicio principal de cuádriceps.
 *  - "Ancla" gana sobre "recortable": si el slot sostiene a algún músculo, no
 *    se sugiere sacarlo.
 */
export function trimRoleBySlot(
  result: VolumeTrimResult,
): Map<string, { role: TrimRole; reason: string; muscle: string }> {
  const out = new Map<string, { role: TrimRole; reason: string; muscle: string }>();
  for (const d of result.decisions) {
    if (d.role === "trim" && !d.direct) continue; // exceso sinergista: no accionable
    const key = `${d.dayIndex}:${d.slotIndex}`;
    const prev = out.get(key);
    if (!prev || (prev.role === "trim" && d.role === "anchor")) {
      out.set(key, { role: d.role, reason: d.reason, muscle: d.muscle });
    }
  }
  return out;
}
