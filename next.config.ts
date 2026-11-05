import type { NextConfig } from "next";
import { execSync } from "node:child_process";
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

const withSerwist = withSerwistInit({
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
  env: { NEXT_PUBLIC_BUILD_SHA: buildSha() },
};

export default withSerwist(nextConfig);
