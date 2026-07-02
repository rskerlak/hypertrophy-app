"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MesoStats } from "@/domain/types";

const COLORS = ["#6d7cff", "#34d399", "#fbbf24", "#f87171", "#22d3ee", "#c084fc"];

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
          <CartesianGrid stroke="#2a2e3a" strokeDasharray="3 3" />
          <XAxis dataKey="week" stroke="#9096a6" fontSize={11} tickLine={false} />
          <YAxis stroke="#9096a6" fontSize={11} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#14161d", border: "1px solid #2a2e3a", borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: "#9096a6" }}
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
