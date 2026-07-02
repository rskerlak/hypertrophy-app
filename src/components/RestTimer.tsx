"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

/** Timer de descanso simple. Cuenta ascendente desde el último set logueado. */
export function RestTimer({ resetKey }: { resetKey: number }) {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const start = useRef<number>(0);

  useEffect(() => {
    if (resetKey === 0) return;
    setRunning(true);
    setSeconds(0);
    start.current = Date.now();
  }, [resetKey]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start.current) / 1000)), 250);
    return () => clearInterval(id);
  }, [running]);

  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;

  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
      <span className="text-sm text-[var(--muted)]">Descanso</span>
      <span className="font-mono text-lg tabular-nums">
        {mm}:{ss.toString().padStart(2, "0")}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setRunning(true);
          setSeconds(0);
          start.current = Date.now();
        }}
      >
        Reiniciar
      </Button>
    </div>
  );
}
