import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hipertrofia",
    short_name: "Hipertrofia",
    description: "App personal de mesociclos de hipertrofia basada en evidencia.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0c10",
    theme_color: "#0b0c10",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
