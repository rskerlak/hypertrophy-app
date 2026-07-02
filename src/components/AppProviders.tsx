"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ensureSeeded } from "@/db/repositories";
import { UpdateToast } from "@/components/UpdateToast";

/**
 * Bootstrap del cliente: siembra la BD, pide persistencia de IndexedDB para
 * evitar evicción, y espera a que todo esté listo antes de renderizar.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (navigator.storage?.persist) {
          await navigator.storage.persist();
        }
        await ensureSeeded();
      } catch (e) {
        console.error("Bootstrap error", e);
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-[var(--muted)]">
        Cargando…
      </div>
    );
  }
  return (
    <>
      {children}
      <UpdateToast />
    </>
  );
}
