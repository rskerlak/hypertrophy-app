/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Las páginas precacheadas se sirven ignorando la query: /session?id=X y
  // /session.txt?id=X resuelven al documento exportado (UX-01). Los ids viven
  // en la query y los datos en IndexedDB, así que el documento es el mismo.
  precacheOptions: { ignoreURLParametersMatching: [/.*/] },
  // A4.3: el SW nuevo espera; se activa solo cuando el usuario toca "actualizar"
  // (mensaje SKIP_WAITING, que Serwist ya escucha) y nunca a mitad de sesión.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
