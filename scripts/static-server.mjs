// Servidor estático mínimo sobre out/ (sin dependencias) para los scripts de
// verificación (a11y, offline). Resuelve /ruta → ruta.html como GitHub Pages.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const OUT = join(process.cwd(), "out");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".woff2": "font/woff2",
};

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^([/\\])+/, "");
  for (const candidate of [clean, `${clean}.html`, join(clean, "index.html")]) {
    const full = join(OUT, candidate);
    if (!full.startsWith(OUT)) return null;
    try {
      if ((await stat(full)).isFile()) return full;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

export async function startStaticServer(PORT) {
const server = createServer(async (req, res) => {
  const file = (await resolveFile(req.url ?? "/")) ?? join(OUT, "404.html");
  res.writeHead(file.endsWith("404.html") && req.url !== "/404" ? 404 : 200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
  });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
return server;
}
