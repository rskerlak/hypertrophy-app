"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Botón para instalar la PWA. En iOS muestra la instrucción manual. */
export function InstallCard() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error propiedad no estándar de Safari iOS
      window.navigator.standalone === true;
    setInstalled(standalone);
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <Card className="mb-4">
      <p className="font-medium">Instalar en el teléfono</p>
      {isIOS ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          En iPhone: tocá el botón Compartir de Safari y elegí «Agregar a inicio». Funciona sin
          conexión.
        </p>
      ) : deferred ? (
        <>
          <p className="mt-1 mb-3 text-xs text-[var(--muted)]">
            Instalala como app para abrirla desde el inicio y usarla offline.
          </p>
          <Button
            size="sm"
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
            }}
          >
            Instalar app
          </Button>
        </>
      ) : (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Desde el menú del navegador elegí «Instalar app» / «Agregar a la pantalla de inicio».
        </p>
      )}
    </Card>
  );
}
