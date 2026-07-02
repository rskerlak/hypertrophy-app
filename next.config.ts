import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

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
};

export default withSerwist(nextConfig);
