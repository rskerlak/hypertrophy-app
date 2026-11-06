// Prueba de uso SIN conexión (auditoría UX-01): con el service worker instalado,
// abrir una sesión NUNCA visitada, registrar y finalizar, todo offline.
// Contra el build estático (`npm run build` antes).
//
//   npm run test:offline
//   OFFLINE_CHANNEL=msedge npm run test:offline

import { chromium } from "playwright-core";
import { startStaticServer } from "./static-server.mjs";

const PORT = Number(process.env.OFFLINE_PORT ?? 4174);
const server = await startStaticServer(PORT);
const B = `http://127.0.0.1:${PORT}`;
const NL = String.fromCharCode(10);
const log = (...a) => process.stdout.write(a.join(" ") + NL);
setTimeout(() => { log("TIMEOUT"); process.exit(2); }, 150000);
const browser = await chromium.launch({ headless: true, ...(process.env.OFFLINE_CHANNEL ? { channel: process.env.OFFLINE_CHANNEL } : {}) });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const dialog = () => page.locator('[role="dialog"]');
let fails = 0;
const check = (ok, m) => { log(ok ? "PASS" : "FAIL", m); if (!ok) fails++; };
await page.goto(B + "/");
for (const t of ["Continuar", "Continuar", "Omitir"]) { const b = page.locator(`button:has-text("${t}")`).first(); if (await b.isVisible().catch(() => false)) await b.click(); }
await page.goto(B + "/plan");
await page.locator('button:has-text("Usar como base")').first().click();
await dialog().waitFor({ timeout: 3000 }).then(() => dialog().locator("button:has-text('Entendido')").click()).catch(() => {});
await page.locator('button:has-text("Generar mesociclo")').first().click();
await page.locator('button:text-is("Generar")').click();
await page.waitForURL(B + "/");
await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("hypertrophy"); q.onsuccess = () => { const tx = q.result.transaction("settings", "readwrite"); const os = tx.objectStore("settings"); os.get("default").onsuccess = (e) => os.put({ ...e.target.result, onboarded: true }); tx.oncomplete = () => r(); }; }));
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await page.waitForTimeout(3000); // precache completo
await ctx.setOffline(true);
await page.goto(B + "/");
await page.waitForTimeout(1500);
await page.locator('a:has-text("Empezar"), button:has-text("Empezar")').first().click();
await page.waitForURL(/\/session\?id=/);
await page.waitForTimeout(1500);
const url = page.url();
const txt = await page.locator("main").innerText().catch(() => "");
check(url.startsWith(B + "/session?id=") && txt.includes("series"), "offline: sesión nunca abierta se abre (" + url.slice(0, 50) + ")");
const skip = page.locator('button:text-is("Saltar")').first();
if (await skip.isVisible().catch(() => false)) await skip.click();
await page.locator('button:text-is("Log")').first().click();
await page.waitForTimeout(500);
await page.locator('button:has-text("Finalizar")').first().click();
await dialog().waitFor(); await dialog().locator('button:has-text("Finalizar")').click();
await page.waitForURL(/\/session\/done\?id=/);
await page.waitForTimeout(1500);
const done = await page.locator("main").innerText().catch(() => "");
check(page.url().includes("/session/done?id=") && done.length > 50, "offline: finalizar muestra el resumen");
await page.goto(B + "/calendar"); await page.waitForTimeout(800);
check((await page.locator("main").innerText()).includes("Agenda"), "offline: agenda abre");
log("FAILS", fails);
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
