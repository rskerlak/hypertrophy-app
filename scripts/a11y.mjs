// Auditoría de accesibilidad (A4.6): axe-core sobre las pantallas principales,
// en tema claro y oscuro, contra el build estático (`npm run build` antes).
// Falla si hay violaciones de impacto "serious" o "critical" (contraste AA incluido).
//
//   npm run test:a11y                 # usa Chromium de playwright-core
//   A11Y_CHANNEL=msedge npm run test:a11y   # o un navegador instalado
//
// Sin dependencias extra: servidor estático propio sobre out/.

import { readFile } from "node:fs/promises";
import { startStaticServer } from "./static-server.mjs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const AXE_SOURCE = await readFile(require.resolve("axe-core/axe.min.js"), "utf-8");
const PORT = Number(process.env.A11Y_PORT ?? 4173);
const NL = String.fromCharCode(10);
const log = (...a) => process.stdout.write(a.join(" ") + NL);

const server = await startStaticServer(PORT);
const B = `http://127.0.0.1:${PORT}`;

const timer = setTimeout(() => {
  log("TIMEOUT");
  process.exit(2);
}, 240000);

const browser = await chromium.launch({ headless: true, ...(process.env.A11Y_CHANNEL ? { channel: process.env.A11Y_CHANNEL } : {}) });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(12000);

// --- Datos mínimos: onboarding + rutina precargada + meso generado.
await page.goto(B + "/");
for (const t of ["Continuar", "Continuar", "Omitir"]) {
  const b = page.locator(`button:has-text("${t}")`).first();
  if (await b.isVisible().catch(() => false)) await b.click();
}
await page.goto(B + "/plan");
await page.locator('button:has-text("Usar como base")').first().click();
const ok = page.locator('[role="dialog"] button:has-text("Entendido")');
if (await ok.isVisible().catch(() => false)) await ok.click();
await page.locator('button:has-text("Generar mesociclo")').first().click();
await page.locator('button:text-is("Generar")').click();
await page.waitForURL(B + "/");
const sessionId = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const q = indexedDB.open("hypertrophy");
      q.onsuccess = () => {
        const r = q.result.transaction("sessions").objectStore("sessions").getAll();
        r.onsuccess = () => resolve(r.result.sort((a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex)[0]?.id);
      };
    }),
);
const exerciseId = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const q = indexedDB.open("hypertrophy");
      q.onsuccess = () => {
        const r = q.result.transaction("exercises").objectStore("exercises").getAll();
        r.onsuccess = () => resolve(r.result[0]?.id);
      };
    }),
);

const SCREENS = [
  "/",
  "/calendar",
  "/plan",
  `/session?id=${sessionId}`,
  `/session/done?id=${sessionId}`,
  "/stats",
  "/mesos",
  "/settings",
  "/exercises",
  `/exercise?id=${exerciseId}`,
  "/measurements",
  "/activities",
];

let failures = 0;
for (const theme of ["light", "dark"]) {
  // El tema real vive en settings (la app lo re-aplica al arrancar).
  await page.evaluate(
    (t) =>
      new Promise((resolve) => {
        localStorage.setItem("mn-theme", t);
        const q = indexedDB.open("hypertrophy");
        q.onsuccess = () => {
          const tx = q.result.transaction("settings", "readwrite");
          const os = tx.objectStore("settings");
          os.get("default").onsuccess = (e) => os.put({ ...e.target.result, theme: t });
          tx.oncomplete = () => resolve();
        };
      }),
    theme,
  );
  for (const path of SCREENS) {
    await page.goto(B + path);
    await page.waitForTimeout(900);
    const applied = await page.evaluate(() => document.documentElement.dataset.theme ?? "light");
    if (applied !== theme) log("  (aviso: tema aplicado", applied, ")");
    await page.addScriptTag({ content: AXE_SOURCE });
    const result = await page.evaluate(async () => {
      // @ts-expect-error axe global inyectado
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + (n.any[0]?.message ? ` — ${n.any[0].message}` : "")),
        count: v.nodes.length,
      }));
    });
    const bad = result.filter((v) => v.impact === "serious" || v.impact === "critical");
    log(bad.length ? "FAIL" : "PASS", theme.padEnd(5), path.replace(/\?id=.*/, "?id=…"), bad.length ? `(${bad.length})` : "");
    for (const v of bad) {
      log(`   ${v.impact} ${v.id}: ${v.help} [${v.count}]`);
      for (const n of v.nodes) log(`     · ${n}`);
    }
    failures += bad.length;
  }
}

// --- Diálogo propio abierto (A4.6): axe + Escape + foco atrapado y devuelto.
await page.goto(B + "/exercises");
await page.waitForTimeout(800);
const trigger = page.locator('button[aria-label^="Eliminar "]').first();
await trigger.click();
await page.locator('[role="dialog"]').waitFor();
await page.addScriptTag({ content: AXE_SOURCE });
const dlg = await page.evaluate(async () => {
  // @ts-expect-error axe global inyectado
  const r = await window.axe.run(document.querySelector('[role="dialog"]'), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} [${v.nodes.length}]`);
});
const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
const stillInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
await page.keyboard.press("Escape");
const closed = (await page.locator('[role="dialog"]').count()) === 0;
const returned = await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? "").startsWith("Eliminar "));
const dialogOk = dlg.length === 0 && focusInside && stillInside && closed && returned;

// Las otras hojas (UX-08): Nuevo meso y Cambiar ejercicio, mismo contrato.
async function sheetCheck(name, open) {
  await open();
  await page.locator('[role="dialog"]').waitFor();
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  const trapped = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  await page.keyboard.press("Escape");
  const gone = (await page.locator('[role="dialog"]').count()) === 0;
  log(trapped && gone ? "PASS" : "FAIL", `hoja ${name}: trap ${trapped} Escape ${gone}`);
  if (!(trapped && gone)) failures++;
}
await sheetCheck("nuevo meso", async () => {
  await page.goto(B + "/mesos");
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Nuevo")').first().click();
});
await sheetCheck("cambiar ejercicio", async () => {
  await page.goto(B + `/session?id=${sessionId}`);
  await page.waitForTimeout(1200);
  const skip = page.locator('button:text-is("Saltar")').first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.locator('button:has-text("Cambiar ejercicio")').first().click();
});
log(dialogOk ? "PASS" : "FAIL", "diálogo: axe", JSON.stringify(dlg), "foco adentro", focusInside, "trap", stillInside, "Escape", closed, "foco devuelto", returned);
if (!dialogOk) failures++;

await browser.close();
server.close();
clearTimeout(timer);
log(failures ? `\n${failures} violaciones serias/críticas` : "\nSin violaciones serias/críticas");
process.exit(failures ? 1 : 0);
