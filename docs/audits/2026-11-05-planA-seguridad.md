# Auditoría Plan A — Pista 3: Seguridad (sección "Cliente (PWA)")

- Commit auditado: `aca8391` (main). `out/` vigente (build posterior al commit, contiene el SHA `aca8391`).
- Alcance: solo "Cliente (PWA)" de `docs/plans/AUDITORIA.md`. La sección "Servidor" es de Plan B y queda fuera.
- Método: lectura de código, grep sobre `src/`, `out/`, `public/`, workflows e historial git, `npm audit`, un GET a `https://myo.noesisargentina.com` para leer headers, la API de GitHub (solo lectura) para la configuración de Actions y Pages, y un test descartable `src/db/__tests__/secaudit.tmp.test.ts` (casos S1–S7, ejecutado con `npx vitest run` y borrado).

## Resumen

1. No hay secretos en el repo, el bundle ni el historial. No hay XSS: React escapa todo, el único `dangerouslySetInnerHTML` es el script estático del tema, no hay `eval`/`innerHTML` y el Excel no admite inyección de fórmulas. Tampoco hay prototype pollution global.
2. La superficie principal es el import de respaldo. Un archivo armado (o dañado) pasa la validación con estructuras sin tipar o números sin tope, reemplaza toda la base y puede dejar la app rota, incluida la pantalla de Ajustes desde la que se recupera. Además no hay tope de tamaño.
3. Faltan defensas en profundidad: no hay CSP, `next` está desactualizado con avisos del lado servidor (no aplican al sitio estático) y el workflow de deploy tiene un token con escritura expuesto a scripts de terceros. No hay hallazgos Altos.

## Checklist "Cliente (PWA)"

| Ítem | Estado | Evidencia |
|---|---|---|
| Sin claves ni tokens en repo ni bundle | **OK** | `grep -rniE "sk-…\|api[_-]?key\|AKIA…\|ghp_…\|PRIVATE KEY\|eyJ…"` sobre `src/ public/ .github/ scripts/ out/` da 0 resultados. `git log --all -S` con `sk-`, `api_key`, `apikey`, `API_KEY`, `password`, `secret` y `token` solo encuentra texto de los planes y `${{ secrets.GITHUB_TOKEN }}`. El `files.zip` que estuvo en el historial (82f3387→852a542) solo tiene los .md y `rules.config.json`. `git ls-files` no tiene respaldos JSON, `*.tmp.*`, `.env` ni `.pem`. No se generan `.map` en `out/`. |
| `localStorage` solo para preferencias de UI | **OK** | Claves encontradas: `localStorage["mn-theme"]` (`src/lib/theme.ts:6,11`, `src/app/layout.tsx:39`), que es un caché de pintado porque la fuente de verdad es `settings.theme` en Dexie, y `sessionStorage["mn-draft:${sid}:${slot}:${set}"]` (`src/app/session/page.tsx:383-408`), borradores de una serie aún no registrada que se borran al registrarla (PLAN_A A1.7 los declara UI). No hay otras claves, ni cookies, ni acceso directo a `indexedDB`. |
| Import: validación Zod completa | **FALLA** | Ver S-01 y S-03. |
| Import: tamaño máximo | **FALLA** | Ver S-02. |
| Import: sin `eval`/`innerHTML`; texto renderizado como texto | **OK** | El único `dangerouslySetInnerHTML` está en `src/app/layout.tsx:45`. Su contenido (`:39`) es una constante sin interpolación. En `src/` no hay `innerHTML`, `eval`, `new Function`, `insertAdjacentHTML`, `document.write` ni `javascript:`, y el bundle de `out/_next/static/chunks` no tiene `eval(` ni `new Function(`. Nombres y notas se renderizan con `{…}` en JSX (`exercise/page.tsx:74`, `session/page.tsx:924`, `activities/page.tsx:59`, `BugReport.tsx:169`). |
| CSP en `out/` vía meta | **FALLA** | Ver S-04. |
| `npm audit --omit=dev` sin altas; versiones fijadas | **FALLA (parcial)** | Ver S-05. Las versiones están fijadas por `package-lock.json` y `npm ci` en CI. `package.json` usa rangos `^`, salvo `next`, `react` y `react-dom`, que van exactos. |

## Hallazgos

| id | severidad | archivo:línea | descripción | reproducción | sugerencia |
|---|---|---|---|---|---|
| S-01 | **Media** | `src/db/backupSchema.ts:88`, `:137`, `:155`; `src/db/repositories.ts:953`; `src/components/BugReport.tsx:169,171`; `src/app/settings/page.tsx:362,366` | **La validación del respaldo no es completa.** `plan.weeks[].days` es `z.array(z.unknown())`: el plan entero (slots, `sets`, cargas, RIR) entra sin validar. `bugReports` usa `looseRow`, que solo exige `id`. Todos los campos opcionales pasan sin tipo por `.passthrough()`: `exercise.note`, `restSec`, `settings.equipmentProfiles`, `units`, `theme`, `equipment.dumbbellPlatesKg`. El import guarda `raw` y no `v.backup`. Un archivo así borra la base y deja filas que rompen la UI. Un bug sin `context` lanza un `TypeError` en `BugListCard` (`b.context.sessionDayLabel`), y un `text` que sea objeto rompe React. Esa tarjeta está en **la misma pantalla que el botón Importar** y no hay `error.tsx`, así que para recuperar hay que borrar los datos del sitio y reimportar la copia `pre-import`. | **S2**: `days: ["basura", {label: 1, slots: [{sets: 1e9, targetLoadKg: "x", targetReps: null}]}]` → `validateBackup(...).ok === true`. **S3**: `exercise.note = {…}`, `settings.equipmentProfiles = "no-es-array"`, `settings.units = {a: 1}`, `bugReports = [{id: "b1", text: {obj: 1}}]` (sin `context` ni `createdAt`) → `ok === true`. El crash de Ajustes sale del código citado y no se ejecutó en navegador, para no tocar la base del origen `localhost:3000` que usa el usuario. | Validar `plan` con el schema del dominio (`MesocyclePlan`) y `bugReports` con el mismo `bugReportInput` del repo más `id`, `createdAt` y `status`. Tipar como `.optional()` los campos opcionales conocidos en vez de dejarlos pasar crudos. Importar `v.backup.data`. Agregar `src/app/settings/error.tsx`, o un boundary alrededor de `BugListCard`, para que el import siga accesible. |
| S-02 | **Media** | `src/components/BackupCard.tsx:27`; `src/db/backupSchema.ts:56,71,85`; `src/app/session/page.tsx:634` | **No hay tope de tamaño ni de cardinalidad.** `JSON.parse(await file.text())` corre sin mirar `file.size` (grep de `file.size` = 0). Los arrays y strings no tienen `.max()`. `targetSets`, `numAccumulationWeeks` y el `sets` del plan son enteros sin techo, y la sesión hace `Array.from({ length: slot.sets })`. Un archivo grande, o un número absurdo, cuelga la pestaña. No hay pérdida de datos porque se valida antes de borrar, pero sí un DoS persistente si el número entra a la base. | **S7**: 200 000 setLogs (40,3 MB) validan `ok` en 1,2 s; con la máquina cargada tardó 6,3 s y venció el timeout de vitest. **S5**: `targetSets = 1e9`, `numAccumulationWeeks = 1e9` y `name = "A" × 2 000 000` → `ok === true`. | Rechazar `file.size > 20 MB` antes de `file.text()` con un mensaje claro. Poner `.max()` de cordura en `DATA_LIMITS`: series ≤ 20, semanas ≤ `maxAccumulationWeeks` del config, strings ≤ 200/2000 y arrays ≤ 10⁶. |
| S-03 | **Media** | `src/db/backupSchema.ts:35-36`; `src/domain/rounding.ts:12`, `:44-50` | **El inventario de equipo no tiene tope superior.** `platesKg: z.number().gt(0)` y `barWeightKg: z.number().min(0)` no tienen `max`. `achievableSideSums` reserva `new Array(maxSideG + 1)` en gramos: un disco de 1e7 kg tira `RangeError` y uno de 1e5 kg pide un array de 10⁸ posiciones, que congela la pestaña. Desde un respaldo, el motor queda sin poder calcular `nextAchievableLoad` en ninguna sesión con barra. | **S4**: `platesKg = [1e7]` → `validateBackup(...).ok === true` y `nextAchievableLoad(80, {type: "barbell", equipment})` lanza `RangeError`. `barWeightKg = 1e300` también valida, y `roundToAvailable(80)` devuelve `1e+300`. | `load` (≤ 2000 kg) para barra y mango. Para discos, `≤ 50 kg` como dato de cordura en `DATA_LIMITS`, que no es un parámetro científico. Aplicar el mismo schema en `settingsRepo.update`. |
| S-04 | **Media** | `out/index.html` (sin `<meta http-equiv>`); `src/app/layout.tsx:41-46`; headers en vivo | **No hay CSP.** No hay meta en el HTML exportado y GitHub Pages no manda el header (GET verificado: `Server: GitHub.com`, sin `Content-Security-Policy`). Hoy no hay XSS explotable. Aun así, una CSP limitaría cualquier exfiltración futura de IndexedDB, por ejemplo desde una dependencia comprometida o un sink nuevo. | `grep -o '<meta[^>]*http-equiv' out/index.html` = 0; `curl -D - https://myo.noesisargentina.com/`. | Ver la propuesta concreta de CSP más abajo. |
| S-05 | **Media** | `package.json:22` (`next 15.5.20`), `:27` (`xlsx ^0.18.5`), `:28` (`zod ^3.24.2`) | **`npm audit --omit=dev`: 15 avisos (1 crítico, 11 altos, 3 moderados).** Ver el detalle de dependencias más abajo. Los críticos y altos de `next` (<15.5.28) son todos del servidor: Server Actions, Image Optimization, ISR, rewrites y RCE en servidores Windows. **No aplican** al sitio estático. Es **sospecha** que afecten a `next dev`/`next start` en la máquina Windows del desarrollador, que escuchan en todas las interfaces. `xlsx`: prototype pollution y ReDoS solo en el camino de **lectura**, y la app solo escribe (`exportExcel.ts`, sin `XLSX.read`), así que no es explotable. `zod` 3.x: agotamiento de memoria con colecciones grandes, solo con el archivo que el propio usuario elige (ver S-02). El resto (`sharp`, `postcss`, `browserslist`, `@serwist/build`, `glob`, `nanoid`, `source-map-js`) es de build. | `npm audit --omit=dev --json`, resumido en el detalle. | Subir `next` y `eslint-config-next` a `15.5.29`, un patch dentro de 15.5. Documentar `xlsx` como excepción solo-escritura, o migrar al tarball oficial `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. `npm audit fix` para las dependencias de build sin cambios mayores. Planificar `zod` 4 para Plan B. |
| S-06 | **Media** | `.github/workflows/deploy-pages.yml:8-9,19,26,30` | **El deploy tiene un token con escritura al alcance de código de terceros.** `permissions: contents: write` vale para todo el job. `actions/checkout@v4` deja el `GITHUB_TOKEN` en `.git/config` por defecto (`persist-credentials: true`). Después corren `npm ci` y `npm run build`, es decir, cualquier `postinstall` o plugin de build de una dependencia, que podrían hacer push a `main` o `gh-pages`. Además, la acción de terceros `peaceiris/actions-gh-pages@v4` está fijada por **tag**, que se puede mover, y no por SHA. `main` no está protegida. Quien escriba en `gh-pages` sirve JS en el origen y con eso lee toda la IndexedDB de los usuarios de la PWA. | Configuración verificada: el YAML citado y `gh api …/actions/permissions` (`allowed_actions: all`, `sha_pinning_required: false`). `default_workflow_permissions: read` es correcto, pero este workflow lo eleva. `…/branches/main/protection` → 404. No se ejecutó ningún ataque. | `persist-credentials: false` en `checkout`. Fijar `peaceiris/actions-gh-pages`, `actions/checkout` y `actions/setup-node` por SHA de commit, con el tag como comentario. Opcional: separar el build (`contents: read`) del push, con un job aparte que solo descargue el artefacto. |
| S-07 | Baja | `src/db/repositories.ts:953` | Las filas importadas conservan la clave `__proto__` como propiedad propia, porque se usa `raw` y no la salida de Zod, que sí la quita. Hoy es inocuo: no hay `Object.assign`, deep merge ni asignación anidada `a[k1][k2]` con claves del archivo (grep), y spread y `structuredClone` copian `__proto__` como dato. Pero un `Object.assign(target, row)` futuro secuestraría el prototipo de `target`. | **S1**: `JSON.parse` con `"__proto__": {"polluted": "yes"}` y `"constructor": {"prototype": …}` en un ejercicio → `ok`. La salida de Zod no tiene `__proto__` propio. Spread y clone lo tienen como dato, con prototipo `Object.prototype`. `Object.assign({}, ex)` → prototipo secuestrado (`polluted === "yes"`). `({}).polluted === undefined`, así que no hay contaminación global. Un acumulador `acc["__proto__"] += 3` (patrón de `volume.ts:24`) no contamina. | Importar `v.backup.data`, como en S-01. |
| S-08 | Baja | `src/components/BugReport.tsx:21-28,72-78`; `src/lib/backup.ts:11` | **Privacidad del respaldo.** Cada bug guarda el `userAgent` (≤ 400 caracteres), el viewport, `standalone`, la ruta con query (ids) y el nombre del meso. El respaldo que el usuario comparte "para reproducir un bug" también lleva peso, medidas corporales, check-ins de sueño y nutrición y notas libres. La UI avisa que el bug viaja en el respaldo (`BugReport.tsx:127-130`), pero no que el respaldo lleva todo. | Lectura de código. | Agregar "Exportar solo bugs", sin `measurements` ni `checkins` ni notas, o un aviso al exportar. Truncar el UA a la familia y versión del navegador. |
| S-09 | Baja | `.gitignore` | El repo es **PUBLIC** (`gh repo view`) y `.gitignore` no cubre `*.tmp.*`, `myonoesis-*.json` ni `*.xlsx`. Un `git add .` subiría un respaldo con datos personales. Ahora mismo hay `src/domain/__tests__/repro.tmp.test.ts` y `sim.tmp.test.ts` sin trackear, de otros auditores. | `git status --short`. | Agregar `*.tmp.*`, `myonoesis-*.json` y `*.xlsx` a `.gitignore`. |
| S-10 | Baja | GitHub Pages / DNS | El dominio propio **no está verificado** en GitHub: `protected_domain_state: null` y no existe el TXT `_github-pages-challenge-rskerlak.noesisargentina.com`, mientras el CNAME apunta a `rskerlak.github.io`. Si Pages se desactiva sin borrar el DNS, otro repo puede reclamar el dominio y servir JS en el origen. No hay HSTS (límite de Pages): la primera visita por `http://` recibe un 301 que se puede degradar, aunque `http://` es otro origen y no ve la IndexedDB. | `gh api repos/rskerlak/hypertrophy-app/pages`; `nslookup`. | Verificar el dominio en *Settings → Pages → Verified domains* de la cuenta. |
| S-11 | Baja | `src/app/sw.ts:21` (`defaultCache`) | `defaultCache` trae una regla general `!sameOrigin` → `NetworkFirst` (`cross-origin`, 1 h, 32 entradas). Hoy no hay pedidos a otros orígenes: el bundle no tiene URLs de red y las fuentes son locales por `next/font`. Pero en Plan B las respuestas GET autenticadas de `api.noesisargentina.com` quedarían en Cache Storage. | Lectura de `node_modules/@serwist/next/dist/index.worker.mjs`. | En Plan B, anteponer una regla `NetworkOnly` para el origen de la API. |
| S-12 | Baja | `package.json:12`; `Abrir MyoNoesis.bat` | `serve out -l 3000` escucha en todas las interfaces (`serve/build/main.js:259`, `listen(port)` sin host) y expone el código estático en la LAN. No expone datos, que viven en el navegador. `serve` tiene un aviso de DoS en `compression` (dependencia de desarrollo). | Lectura del código de `serve`. | `serve out -l tcp://127.0.0.1:3000`. |
| S-13 | Baja | `src/app/calendar/page.tsx:95,123`, `src/app/page.tsx:134`, `src/app/stats/page.tsx:288` | Los ids se interpolan en query strings sin `encodeURIComponent`. Un id importado con `&` o `#` rompe la navegación. No hay XSS porque el prefijo de la ruta es fijo. | Lectura de código. | `encodeURIComponent(id)`, o restringir `id` a `[\w-]+` en el schema. |
| S-14 | sospecha | `src/lib/backup.ts:17-18`; `src/components/BackupCard.tsx:47-48` | La copia `pre-import` se descarga con `a.click()` y enseguida `URL.revokeObjectURL`, sin forma de confirmar que bajó. En iOS Safari como PWA instalada, donde las descargas de blob son poco fiables, la copia podría no guardarse y el import seguiría igual. No se reprodujo porque no hay dispositivo iOS disponible: no cuenta para el gate y corresponde verificarlo en la Pista 1. | No reproducido. | Revocar en `setTimeout(…, 1000)`. En modo standalone, ofrecer compartir con `navigator.share({ files })` y pedir confirmación antes de reemplazar. |

**Conteo:** Alta 0 · Media 6 (S-01…S-06) · Baja 7 (S-07…S-13) · sospecha 1 (S-14).

### Detalle de dependencias

- `npm audit --omit=dev`: 15 avisos (crit 1, high 11, mod 3).
  - Runtime en el navegador: `xlsx` (high, solo lectura, no se usa) y `zod` (high, ver S-02).
  - Server/build: `next` (crit/high), `@serwist/*`, `sharp`, `postcss`, `browserslist`, `nanoid`, `source-map-js`, `glob`, `minimatch`, `baseline-browser-mapping`.
- `npm audit` completo: 28 avisos (crit 3, high 16, mod 9). Lo exclusivo de dev:
  - `tinypool` y `vitest` (crit).
  - `vite` (high).
  - `serve` → `compression`, `fast-uri` y `js-yaml` (high).
  - `@typescript-eslint/*` y `@vitest/mocker` (mod).
  - Nada de esto llega al bundle publicado.

### Propuesta de CSP (S-04)

Next mete scripts inline: 9 `<script>` sin `src` en `index.html` (los `self.__next_f.push(...)` del payload RSC y el script del tema). Su contenido cambia por página y por build, así que hay dos opciones.

**A. Simple, en `layout.tsx` dentro de `<head>`:**

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
```

- `'unsafe-inline'` en scripts anula la protección contra XSS inline, pero hoy no hay vector inline.
- Lo que sí se gana es `connect-src 'self'`: bloquea `fetch`/XHR/beacon hacia otros orígenes, que es la vía de exfiltración de IndexedDB.
- También se ganan `object-src 'none'` y `base-uri 'self'`.
- No hace falta `'unsafe-eval'`: el bundle no tiene `eval` ni `new Function`.
- En Plan B: `connect-src 'self' https://api.noesisargentina.com`.

**B. Estricta, con un paso `postbuild`:** un script recorre `out/**/*.html`, calcula `sha256` de cada `<script>` inline e inyecta en cada HTML una meta con `script-src 'self' 'sha256-…' …`.

- No usa `'unsafe-inline'` en scripts.
- Costo: un script de build más, y conviene verificarla en E2E porque un hash que falte rompe la hidratación.

Límites de la meta: no soporta `frame-ancestors`, `report-uri` ni `sandbox`. El clickjacking queda mitigado igual por el particionado de almacenamiento: enmarcada en un sitio ajeno, la app ve una IndexedDB vacía.

## Lo que está bien y hay que preservar

- **Validar antes de borrar:** `BackupCard` valida antes de preguntar. `backupRepo.import` vuelve a validar y reemplaza dentro de **una transacción** `rw` sobre las 10 tablas. Se descarga una copia `pre-import` antes de importar. Los mensajes de error nombran la tabla, la fila y el campo.
- **Sin sinks peligrosos:** el script del tema es una constante estática dentro de `try/catch` que solo acepta `"dark"` o `"light"`. React escapa todo el texto de usuario. Los nombres de archivo de Excel se sanean (`exportExcel.ts:158`).
- **Excel sin inyección de fórmulas:** `aoa_to_sheet` escribe los strings como `t="str"` con `<v>` y sin `<f>` (**S6**: `=HYPERLINK(…)`, `+1+cmd|…`, `-2+3`, `@SUM(1,1)` y `=1+1` quedan como texto). Si algún día se agrega un export **CSV**, ahí sí hay que anteponer `'` a los valores que empiezan con `= + - @`.
- **Service worker:**
  - `skipWaiting: false`. `SKIP_WAITING` solo sale de la página al tocar el aviso (`UpdateToast.tsx:66`), y el SW lo escucha solo de clientes del mismo origen (`out/sw.js`).
  - Nunca recarga a mitad de sesión. `reloadOnOnline: false` y `disable` en dev.
  - Hoy no cachea pedidos a otros orígenes porque no los hay.
  - Llama a `navigator.storage.persist()` (`AppProviders.tsx:22`).
- **CI y Pages:** `default_workflow_permissions: read` en el repo, `a11y.yml` corre sin permisos de escritura y Pages tiene HTTPS forzado con certificado vigente.
- **Higiene del repo:** sin secretos, `.env*` y `*.pem` ignorados, `public/` sin datos y `out/` sin source maps.
- **Datos fuera del almacenamiento web:** no se usan `localStorage` ni `sessionStorage` para datos de dominio.

## Tests sugeridos (no implementados)

| Nombre | Qué fija |
|---|---|
| `backupSchema.rejectsUnvalidatedPlan` | `plan.weeks[].days` con slot sin `exerciseId`/`sets` o con tipos erróneos → `ok: false` y mensaje con ruta. |
| `backupSchema.rejectsMalformedBugReport` | `bugReports` sin `context`/`createdAt`/`text` string → `ok: false`. |
| `backupSchema.boundsCardinality` | `targetSets > 20`, `numAccumulationWeeks > maxAccumulationWeeks` y strings > N → `ok: false`. |
| `backupSchema.boundsEquipment` | `platesKg: [1e7]` y `barWeightKg: 1e300` → `ok: false`. |
| `rounding.neverAllocatesUnbounded` | `nextAchievableLoad` y `roundToAvailable` con discos grandes no lanzan excepción y terminan rápido. |
| `backupImport.usesValidatedOutput` | Con un repo inyectable o el pure helper: el objeto que se persiste no tiene `__proto__` propio. |
| `backupCard.rejectsOversizeFile` | Con la lógica extraída a una función pura: `size > MAX_BACKUP_BYTES` → error antes de leer. |
| `exportExcel.noFormulaCells` | Fijar S6 como regresión: ninguna celda con `.f`. |
| `csp.metaPresent` (e2e/a11y script) | `out/*.html` contiene la meta CSP con `connect-src 'self'`. |

## Correcciones propuestas para hallazgos Altos

No hay hallazgos Altos.

## Veredicto

**APROBADO CON OBSERVACIONES.** Sin Altos abiertos, la fase pasa el gate. Los 6 Medios (S-01…S-06) son de la Pista 3. En Plan A la Pista 3 no es principal, así que no bloquean el cierre de A, pero **deben cerrarse antes de empezar Plan B**: S-01, S-02 y S-04 condicionan el sync, y S-06 el deploy de B. Plan B puede empezar en paralelo con estas correcciones como primera tarea.
