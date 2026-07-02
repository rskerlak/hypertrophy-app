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

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default withSerwist(nextConfig);
