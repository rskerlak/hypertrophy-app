import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import withSerwistInit from "@serwist/next";

// SHA corto del build: viaja en cada bug anotado para saber qué versión corría.
function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

// Rutas exportadas (cada page.tsx de src/app). Se precachean su HTML y su payload
// RSC (.txt) para que la app abra SIN conexión aunque nunca se haya visitado esa
// pantalla (auditoría UX-01: /session?id=… de una sesión nueva fallaba offline).
function appRoutes(dir = join(process.cwd(), "src", "app")): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("(")) out.push(...appRoutes(full));
    else if (e.name === "page.tsx") {
      const rel = relative(join(process.cwd(), "src", "app"), dir).split(sep).join("/");
      out.push(rel ? `/${rel}` : "/");
    }
  }
  return out;
}

const sha = buildSha();
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
const pageEntries = appRoutes().flatMap((r) => [
  { url: `${base}${r}`, revision: sha },
  { url: `${base}${r === "/" ? "/index" : r}.txt`, revision: sha },
]);

const withSerwist = withSerwistInit({
  additionalPrecacheEntries: pageEntries,
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Deshabilitado en dev a propósito (evita "cache hell" recargando en el gym).
  disable: process.env.NODE_ENV === "development",
  // No recargar a media sesión al recuperar conexión (perdería un formulario a medio llenar).
  reloadOnOnline: false,
});

// basePath para hosting en subruta (GitHub Pages: /hypertrophy-app).
// En Vercel/local queda vacío (raíz). Lo setea el workflow de Pages.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BUILD_SHA: sha },
};

export default withSerwist(nextConfig);
