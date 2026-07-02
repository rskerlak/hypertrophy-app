"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { exerciseRepo } from "@/db/repositories";
import { getRules } from "@/lib/rulesLoader";
import { EQUIPMENT_LABELS, muscleLabel } from "@/lib/format";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { ExerciseForm, type ExerciseDraft } from "@/components/ExerciseForm";
import type { Exercise } from "@/domain/types";

export default function ExercisesPage() {
  const router = useRouter();
  const rules = getRules();
  const exercises = useLiveQuery(() => exerciseRepo.all(), []);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "new" } | { kind: "edit"; ex: Exercise }>({
    kind: "list",
  });

  const filtered = useMemo(() => {
    if (!exercises) return [];
    const term = q.toLowerCase();
    return exercises
      .filter((e) => e.name.toLowerCase().includes(term) || muscleLabel(e.primaryMuscle).toLowerCase().includes(term))
      .sort((a, b) => a.primaryMuscle.localeCompare(b.primaryMuscle) || a.name.localeCompare(b.name));
  }, [exercises, q]);

  const byMuscle = useMemo(() => {
    const m = new Map<string, Exercise[]>();
    for (const e of filtered) {
      const arr = m.get(e.primaryMuscle) ?? [];
      arr.push(e);
      m.set(e.primaryMuscle, arr);
    }
    return m;
  }, [filtered]);

  if (mode.kind === "new") {
    return (
      <>
        <PageHeader title="Nuevo ejercicio" subtitle="Personalizado" />
        <ExerciseForm
          onCancel={() => setMode({ kind: "list" })}
          onSave={async (draft: ExerciseDraft) => {
            await exerciseRepo.createCustom(draft);
            setMode({ kind: "list" });
          }}
        />
      </>
    );
  }

  if (mode.kind === "edit") {
    return (
      <>
        <PageHeader title="Editar ejercicio" subtitle={mode.ex.custom ? "Personalizado" : "De la biblioteca"} />
        <ExerciseForm
          initial={mode.ex}
          onCancel={() => setMode({ kind: "list" })}
          onSave={async (draft) => {
            await exerciseRepo.update(mode.ex.id, draft);
            setMode({ kind: "list" });
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Ejercicios"
        subtitle={`${exercises?.length ?? 0} en la biblioteca`}
        action={
          <Button size="sm" onClick={() => router.push("/settings")} variant="ghost">
            ← Ajustes
          </Button>
        }
      />

      <Button className="mb-3 w-full" onClick={() => setMode({ kind: "new" })}>
        + Crear ejercicio personalizado
      </Button>

      <Input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4" />

      <div className="space-y-4">
        {rules.muscles
          .filter((m) => byMuscle.has(m))
          .map((m) => (
            <div key={m}>
              <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">{muscleLabel(m)}</h2>
              <Card className="divide-y divide-[var(--border)] p-0">
                {byMuscle.get(m)!.map((ex) => (
                  <div key={ex.id} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{ex.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {EQUIPMENT_LABELS[ex.equipmentType]}
                        {ex.resistanceProfile === "stretch" && " · estiramiento"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {ex.custom && <Badge tone="primary">propio</Badge>}
                      <button className="px-1.5 text-sm text-[var(--muted)]" onClick={() => setMode({ kind: "edit", ex })}>
                        ✎
                      </button>
                      <button
                        className="px-1.5 text-sm text-[var(--danger)]"
                        onClick={() => {
                          if (confirm(`¿Eliminar "${ex.name}"?`)) exerciseRepo.remove(ex.id);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          ))}
      </div>
    </>
  );
}
