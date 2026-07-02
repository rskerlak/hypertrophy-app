"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Screen Wake Lock durante la sesión activa. Envuelto en try/catch (el SO puede
 * denegarlo por batería) y re-adquirido en `visibilitychange` (el lock se libera
 * al minimizar/cambiar de pestaña).
 */
export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  const acquire = useCallback(async () => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      sentinelRef.current = await navigator.wakeLock.request("screen");
    } catch {
      // denegado (batería baja, permiso): degradar silenciosamente
    }
  }, [enabled]);

  const release = useCallback(async () => {
    try {
      await sentinelRef.current?.release();
    } catch {
      /* noop */
    }
    sentinelRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      release();
      return;
    }
    acquire();
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled, acquire, release]);
}
