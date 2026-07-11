"use client";

import type { CorrelationResult } from "@/domain/correlations";
import { CORRELATION_LABELS } from "@/lib/format";

/** Color divergente: volt para r>0, rojo para r<0, intensidad ∝ |r|. */
function cellColor(r: number | null): string {
  if (r === null) return "transparent";
  const a = Math.min(1, Math.abs(r)) * 0.75;
  const base = r >= 0 ? "var(--primary)" : "var(--danger)";
  return `color-mix(in srgb, ${base} ${Math.round(a * 100)}%, transparent)`;
}

function cellText(r: number | null): string {
  if (r === null) return "·";
  if (r === 1) return "1";
  return r.toFixed(1).replace("0.", ".").replace("-0.", "-.");
}

export function CorrelationHeatmap({ result }: { result: CorrelationResult }) {
  const { variables, matrix } = result;
  const label = (v: string) => CORRELATION_LABELS[v] ?? v;

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[3px]">
        <thead>
          <tr>
            <th />
            {variables.map((v) => (
              <th key={v} className="h-24 min-w-[30px] align-bottom">
                <div className="mx-auto w-[14px] -rotate-90 whitespace-nowrap text-left text-[10px] font-medium text-[var(--muted)]">
                  {label(v)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variables.map((vi, i) => (
            <tr key={vi}>
              <td className="whitespace-nowrap pr-2 text-right text-[10px] font-medium text-[var(--muted)]">
                {label(vi)}
              </td>
              {variables.map((vj, j) => {
                const r = matrix[i][j];
                return (
                  <td
                    key={vj}
                    title={`${label(vi)} × ${label(vj)}: ${r === null ? "sin datos suficientes" : `r = ${r}`}`}
                    className="h-[30px] min-w-[30px] rounded-md text-center text-[9px] tabular-nums"
                    style={{
                      background: cellColor(r),
                      color: r !== null && Math.abs(r) > 0.5 ? "var(--primary-fg)" : "var(--muted)",
                      border: r === null ? "1px dashed var(--border)" : "none",
                    }}
                  >
                    {cellText(r)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "color-mix(in srgb, var(--primary) 75%, transparent)" }} />
          correlación +
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "color-mix(in srgb, var(--danger) 75%, transparent)" }} />
          correlación −
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-[var(--border)]" />
          sin datos
        </span>
      </div>
    </div>
  );
}
