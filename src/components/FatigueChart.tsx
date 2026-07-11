"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MesoStats } from "@/domain/types";

const COLORS = ["#84cc16", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];

/** Reps a carga fija por semana, una línea por ejercicio. */
export function FatigueChart({
  data,
  exNames,
}: {
  data: MesoStats["fatigueTrajectory"];
  exNames: Map<string, string>;
}) {
  // Unir por semana en un solo dataset ancho.
  const weeks = new Set<number>();
  for (const t of data) for (const p of t.points) weeks.add(p.weekIndex);
  const rows = [...weeks]
    .sort((a, b) => a - b)
    .map((w) => {
      const row: Record<string, number> = { week: w + 1 };
      for (const t of data) {
        const p = t.points.find((x) => x.weekIndex === w);
        if (p) row[t.exerciseId] = p.reps;
      }
      return row;
    });

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="week" stroke="var(--muted)" fontSize={11} tickLine={false} />
          <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: "var(--muted)" }}
            formatter={(v, key) => [`${v} reps`, exNames.get(String(key)) ?? String(key)]}
            labelFormatter={(l) => `Semana ${l}`}
          />
          {data.map((t, i) => (
            <Line
              key={t.exerciseId}
              type="monotone"
              dataKey={t.exerciseId}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
