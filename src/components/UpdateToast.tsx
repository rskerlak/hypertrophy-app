"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { sessionRepo } from "@/db/repositories";
import { shouldShowUpdatePrompt, updateActionOnTap } from "@/lib/updateGate";
import { askConfirm } from "@/store/dialogs";

/**
 * Aviso de nueva versión (A4.3). El service worker nuevo queda ESPERANDO
 * (`skipWaiting: false`); recién cuando el usuario toca, se le envía
 * `SKIP_WAITING`, toma control y la página recarga. Con una sesión en curso,
 * pregunta antes y permite posponerlo hasta terminarla. Nunca recarga solo.
 */
export function UpdateToast() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [deferred, setDeferred] = useState(false);
  const applying = useRef(false);
  const inProgress = useLiveQuery(async () => !!(await sessionRepo.inProgress()), [], false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;

    const track = (r: ServiceWorkerRegistration) => {
      // Solo es "actualización" si ya hay un SW controlando la página.
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const w = r.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        });
      });
    };

    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) return;
      reg = r;
      track(r);
      r.update().catch(() => {});
    });

    const onChange = () => {
      if (applying.current) location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);

    // Buscar actualizaciones al volver a la app.
    const onVisible = () => {
      if (document.visibilityState === "visible") reg?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const gate = { waiting: !!waiting, sessionInProgress: inProgress, deferred };
  if (!shouldShowUpdatePrompt(gate)) return null;

  const apply = () => {
    if (!waiting) return;
    applying.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  const onTap = async () => {
    if (updateActionOnTap(gate) === "apply") return apply();
    const now = await askConfirm({
      title: "Sesión en curso",
      message:
        "Tus series ya están guardadas, pero actualizar recarga la app y corta el timer de descanso. Podés actualizar ahora o cuando termines la sesión.",
      confirmLabel: "Actualizar ahora",
      cancelLabel: "Al terminar",
    });
    if (now) apply();
    else setDeferred(true);
  };

  return (
    <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-6">
      <button
        type="button"
        onClick={onTap}
        className="flex items-center gap-2 rounded-full border border-[var(--primary)]/40 bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-ink)] shadow-[var(--pop-shadow)] backdrop-blur"
      >
        ✦ Nueva versión lista — tocá para actualizar
      </button>
    </div>
  );
}
