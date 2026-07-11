"use client";

import { useEffect, useState } from "react";

/**
 * Aviso de nueva versión: cuando un service worker nuevo toma control
 * (skipWaiting + clientsClaim), la página sigue corriendo los assets viejos
 * hasta recargar. Este toast ofrece recargar — nunca recarga solo (podría
 * perder un formulario a media sesión en el gym).
 */
export function UpdateToast() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Solo es "actualización" si ya había un SW controlando la página.
    const hadController = !!navigator.serviceWorker.controller;

    const onChange = () => {
      if (hadController) setShow(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);

    // Buscar actualizaciones al abrir y al volver a la app.
    const check = () => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-6">
      <button
        onClick={() => location.reload()}
        className="flex items-center gap-2 rounded-full border border-[var(--primary)]/40 bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--primary)] shadow-[var(--pop-shadow)] backdrop-blur"
      >
        ✦ Nueva versión lista — tocá para actualizar
      </button>
    </div>
  );
}
