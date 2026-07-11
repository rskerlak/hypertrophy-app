import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyoNoesis",
    short_name: "MyoNoesis",
    description: "Mesociclos de hipertrofia basados en evidencia. Motor determinista y transparente.",
    // URLs relativas al manifest: funcionan tanto en raíz (Vercel) como en
    // subruta (GitHub Pages: /hypertrophy-app/) sin lógica de basePath.
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#f6f6f3",
    theme_color: "#f6f6f3",
    orientation: "portrait",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
