# Investigación: Cómo escribir el CLAUDE.md y la especificación técnica para construir tu app de hipertrofia con Claude Code

## TL;DR
- **Escribe DOS documentos separados con roles distintos:** un `CONTEXT.md`/PRD extenso y versionado (el "qué construir" — fuente de verdad, sin límite de longitud) y un `CLAUDE.md` corto (bajo 300 líneas, idealmente <150 — el "cómo trabajar en este repo"). Anthropic es explícito en sus docs oficiales: "Los CLAUDE.md inflados hacen que Claude ignore tus instrucciones reales." La lógica científica va en un tercer archivo de datos (`rules.config.json`) separado del código.
- **Valida tu stack con un ajuste:** Next.js + PWA (Serwist) + Dexie.js/IndexedDB + shadcn/ui + Zustand + Recharts + react-hook-form/Zod es la elección correcta y consolidada para 2025-2026. La única recomendación de refinamiento: como la app es single-user, offline-first y sin backend, usa Next.js en modo **static export** (`output: 'export'`) — no necesitas SSR/Server Actions, y el export estático simplifica el hosting y elimina complejidad. Vite + React es una alternativa igualmente válida y más ligera; Next.js gana solo si valoras su tooling y routing.
- **Arquitectura clave: "dominio puro + adaptadores".** El motor de cálculo científico debe ser funciones puras deterministas y testeables que leen `rules.config.json`, totalmente aisladas de React/IndexedDB. La progresión se dispara por **sesión completada, no por fecha**; el calendario es solo una capa de agenda. Especifica los 4 modelos de progresión y el redondeo de cargas como funciones puras con tests unitarios.

## Key Findings

### A. CLAUDE.md y context engineering (práctica consolidada 2025-2026)

1. **CLAUDE.md ≠ especificación/PRD.** Son artefactos distintos y complementarios. El CLAUDE.md contiene instrucciones persistentes sobre *cómo trabajar en el repo* (comandos, convenciones, gotchas). El PRD/spec describe *qué construir*. Según la documentación oficial de Anthropic, "no hay formato requerido para CLAUDE.md, pero manténlo corto y legible por humanos".

2. **Longitud óptima:** El consenso de la comunidad, según el blog de HumanLayer ("Writing a good CLAUDE.md"), es explícito: "Aunque Anthropic no tiene una recomendación oficial sobre cuán largo debe ser tu CLAUDE.md, el consenso general es que <300 líneas es lo mejor, y más corto es aún mejor. En HumanLayer, nuestro CLAUDE.md raíz tiene menos de sesenta líneas." La razón cuantitativa (DataCamp): la adherencia a instrucciones "empieza a degradarse alrededor de 150 a 200 instrucciones totales", y como el system prompt de Claude Code ya consume ~50, te quedan ~100-150 "slots" para tu proyecto.

3. **El test de cada línea (cita textual de los Claude Code Docs oficiales):** "Para cada línea, pregunta: '¿Eliminar esto causaría que Claude cometa errores?' Si no, córtala... Si tu CLAUDE.md es demasiado largo, Claude ignora la mitad porque las reglas importantes se pierden en el ruido... ¡Los CLAUDE.md inflados hacen que Claude ignore tus instrucciones reales!" (Un dato técnico revelador de HumanLayer: Claude Code inyecta un `<system-reminder>` junto a tu CLAUDE.md diciendo "este contexto puede o no ser relevante... no deberías responder a este contexto a menos que sea altamente relevante", lo que explica por qué Claude descarta contenido que juzga irrelevante.)

4. **Qué incluir vs. excluir (tabla oficial de Anthropic):**
   - INCLUIR: comandos bash que Claude no puede adivinar; reglas de estilo que difieren de los defaults; instrucciones de testing; etiqueta del repo (naming de ramas); decisiones arquitectónicas específicas del proyecto; quirks del entorno (env vars); gotchas no obvios.
   - EXCLUIR: cualquier cosa que Claude pueda deducir leyendo código; convenciones estándar del lenguaje; documentación de API detallada (enlaza en su lugar); información que cambia con frecuencia; descripciones archivo-por-archivo; prácticas evidentes ("escribe código limpio").

5. **Spec-driven development (SDD) es la práctica emergente dominante.** GitHub Spec Kit estructura el trabajo como Constitution → Specify → Plan → Tasks, haciendo del spec la única fuente de verdad. Un spec de SDD no es un PRD con etiqueta nueva: un PRD se escribe para humanos que llenan ambigüedades con contexto organizacional; un spec para agentes debe ser explícito porque "sin scope explícito, los agentes hacen suposiciones y van en la dirección equivocada rápido". El spec debe definir comportamiento externo: mapeos entrada/salida, precondiciones/postcondiciones, invariantes, contratos de interfaz, máquinas de estado.

6. **Workflow oficial recomendado por Anthropic: Explorar → Planificar → Implementar → Commit.** Usa **plan mode** para separar exploración de ejecución. "Dejar que Claude salte directo a codear puede producir código que resuelve el problema equivocado." Los specs más útiles son autocontenidos: nombran los archivos e interfaces involucrados, dicen qué está fuera de scope, y terminan con un paso de verificación end-to-end.

7. **Dale a Claude una forma de verificar su trabajo.** Esta es la práctica número uno de Anthropic: "Claude para cuando el trabajo parece hecho. Sin un check que pueda correr, 'parece hecho' es la única señal disponible." Provee tests, un build, o un script que compare output. Para el motor de cálculo, esto significa tests unitarios de las reglas de progresión.

8. **Dividir en fases con checklists.** La comunidad (HumanLayer, metodología RPI: Research-Plan-Implement) y Anthropic coinciden: haz un plan por fases con gates, cada fase con múltiples tests. Consejo clave de la comunidad: **divide el PRD en "rebanadas verticales" (tracer bullets) que crucen todas las capas (datos + lógica + UI)** — los agentes por defecto hacen fases horizontales (primero toda la DB, luego toda la API, luego el frontend), lo que retrasa el feedback end-to-end hasta el final.

9. **Herramientas específicas de Claude Code (consolidadas):**
   - **`/init`**: genera un CLAUDE.md inicial analizando el codebase.
   - **Subagentes** (`.claude/agents/*.md`): corren en contexto propio; úsalos para investigación y para revisión adversarial ("usa un subagente para revisar el diff contra PLAN.md").
   - **Slash commands / Skills** (`.claude/skills/<name>/SKILL.md`): para workflows repetibles y conocimiento de dominio cargado bajo demanda (progressive disclosure). Pon la lógica científica del motor como un skill invocable, no en CLAUDE.md.
   - **Hooks** (`.claude/settings.json`): deterministas, se ejecutan de forma garantizada por el harness (a diferencia de las instrucciones de CLAUDE.md que son "advisory"/consejo). Usa PreToolUse para bloquear acciones peligrosas y PostToolUse para auto-formateo/lint.
   - **@imports**: CLAUDE.md puede importar archivos con `@path/to/file.md` (hasta 5 niveles). Úsalo para enlazar el PRD y el documento científico sin inflar el contexto base.
   - **MCP**: probablemente NO lo necesitas para esta app local sin servicios externos.

10. **Errores comunes a evitar (documentados por Anthropic):**
    - *Kitchen sink session* → usa `/clear` entre tareas no relacionadas.
    - *Corregir una y otra vez* → tras dos correcciones fallidas, `/clear` y reescribe el prompt.
    - *CLAUDE.md sobre-especificado* → poda sin piedad.
    - *Trust-then-verify gap* → siempre provee verificación.
    - *Exploración infinita* → acota o usa subagentes.
    - Alucinación de librerías / over-engineering: el reviewer adversarial tiende a reportar problemas aunque el trabajo sea sólido, lo que lleva a sobre-ingeniería; instruye "reporta solo gaps que afecten corrección o requisitos declarados".

### B. Stack y arquitectura (validación de tu decisión)

11. **Next.js PWA + IndexedDB/Dexie es óptimo y está validado.** Es el patrón consolidado para apps offline-first de tracking. Refinamiento recomendado: para single-user sin backend, considera **static export** de Next.js (`output: 'export'`) — la propia doc de Next.js señala que si no necesitas servidor, el static export aplica, aunque debes mover Server Actions a llamadas externas (que aquí no tienes). Alternativa a evaluar: **Vite + React** es más ligero si no valoras el App Router/tooling de Next.js; la decisión es de preferencia, no de corrección.

12. **PWA/Service Worker: usa Serwist.** `next-pwa` está sin mantener; `@ducanh2912/next-pwa` es un fork, pero **Serwist es el sucesor** y el método recomendado en la documentación oficial de Next.js. Config crítica: `disable: process.env.NODE_ENV === 'development'` (evita "cache hell") y `reloadOnOnline: false` (evita que un reload borre un formulario a medio llenar — crucial en el gimnasio).

13. **Persistencia: Dexie.js es el mejor default para 2026.** Según la comparativa de PkgPulse (mayo 2026): "Dexie.js es el mejor default para datos tipo-app en IndexedDB en 2026: tablas tipadas, queries indexadas ricas, transacciones, versionado de esquema, y dexie-react-hooks para render reactivo en React." El hook `useLiveQuery` hace de IndexedDB la única fuente de verdad para el render de React. `idb` es más bajo nivel; `localForage` solo para key-value simple.

14. **UI/estado/gráficos/formularios (todos consolidados 2025-2026):**
    - UI: **shadcn/ui + Tailwind** (generador de componentes que copias a tu repo y posees; construido sobre Radix, accesible).
    - Estado: **Zustand** (ligero, ideal para single-user sin la complejidad de Redux).
    - Gráficos: **Recharts** (el componente Chart de shadcn usa Recharts; "está bien para dashboards"). Para canvas de alto rendimiento, una librería dedicada.
    - Formularios: **react-hook-form + Zod** (validación type-safe, el stack estándar; shadcn tiene soporte integrado).
    - Calendario: shadcn tiene un componente Calendar (sobre react-day-picker); para vista de agenda más rica, evalúa alternativas dedicadas.

15. **Wake Lock para el gimnasio: sí, es viable.** El Screen Wake Lock API está soportado en todos los navegadores mayores (desde enero 2025; en PWAs instaladas de iOS funciona bien desde iOS 18.4, tras un bug de larga data corregido por Apple). Envuelve `navigator.wakeLock.request('screen')` en try/catch, re-adquiere en el evento `visibilitychange`, y muestra un toggle en la UI. El lock se libera automáticamente al minimizar la app.

16. **Arquitectura recomendada: dominio puro + adaptadores (Repository Pattern).** La UI nunca habla directo con la persistencia; interactúa con una capa "repository" que lee de IndexedDB. El motor de cálculo científico debe ser funciones puras (sin efectos, sin React, sin Dexie) que reciben estado + config y devuelven decisiones. Esto lo hace trivialmente testeable con unit tests.

### C. Configuración científica versionable

17. **Separa "políticas (data)" de "mecanismo (código)".** Es un patrón establecido (rules engine). Las reglas viven en JSON versionable; el código es un "wrapper" que las ejecuta. Beneficio directo: recalibras umbrales editando JSON sin tocar la lógica ni re-testear el motor. Ventaja añadida al vivir en archivos: versionas con git (commiteable y diffeable — exactamente lo que quieres aquí).

18. **Estructura sugerida del `rules.config.json`** (con `schemaVersion` para migraciones): bloques para `volumeLandmarks` por perfil y músculo (MEV/MAV/MRV en sets/semana), `rirSchedule` por longitud de meso, `progressionModels` (parámetros de las 4 progresiones), `deloadTriggers`, `loadIncrements` (redondeo a discos disponibles), y `experienceProfiles` (novato/medio/avanzado).

### D. Lógica algorítmica científica concreta (validada con fuentes RP y literatura)

19. **Volume landmarks (RP / Dr. Mike Israetel):** empieza cada mesociclo en MEV, sube hacia MAV semana a semana, deload al hit MRV. MV ≈ 6 sets/músculo/semana. Rangos típicos citados: MEV ~10-12 sets/semana, MRV ~18-25. **Los landmarks suben con la experiencia**: un principiante puede crecer con 4 sets/semana de pecho, un intermedio ~8, un avanzado puede no crecer bajo 12. Ejemplo RP de rampa: Sem1 12 → 14 → 16 → 18 → Sem5 20 (≈MRV) → Sem6 deload 6 sets.

20. **Algoritmo de progresión de sets de RP (rúbrica publicada):** evalúa la semana previa en dos métricas de 1-4 puntos:
    - *Recuperación de soreness:* sin soreness=1, sanó bien antes=2, sanó justo a tiempo=3, aún dolorido=4.
    - *Performance:* superó objetivos fácil=1, cumplió=2, batalló=3, no igualó semana previa=4.
    - **Outputs:** 1s en ambas → +2-3 sets; 2s o mezcla 1-2 → +1 set; algún 3 con soreness 3-4 → mantener (+0); 4 en performance → sesión de recuperación o deload.

21. **Disparadores de deload (fuentes RP):** el trigger primario es **caída de performance** (no igualar reps de la semana previa en 2+ ejercicios ≈ MRV alcanzado); soreness que no recupera por semanas; MRV sistémico (sueño/apetito caen, más propensión a enfermarse). Estructura del deload RP: **volumen a MEV/≈mitad de sets** (ej. ~20 sets pico → 6 sets), **carga = la de Semana 1 la primera mitad de la semana, luego 50% de la carga de Semana 1 la segunda mitad**, y **reps ≈ mitad** de las de Semana 1.

22. **Progresión de RIR por semana (RP "Progressing for Hypertrophy"):** "en una fase de acumulación de 4 semanas puedes empezar en 4 RIR, luego 3 RIR, 2 RIR, y finalmente 1 RIR en la última semana antes del deload." RIR llega a **0 (ejercicios sin riesgo de barra) o 1 (ejercicios con riesgo)** en la última semana. Rango de validez de un set: 0-4 RIR, 5-30 reps, 30-85% 1RM.

23. **Longitud de mesociclo por experiencia (RP / Israetel):** principiantes con alta recuperación pueden acumular hasta ~12 semanas; muy avanzados solo ~3-4 semanas antes de necesitar deload; el default típico es **4-6 semanas de acumulación + 1 deload**.

24. **Incrementos de carga (RP Help Center):** "el peso se incrementa unos pocos puntos porcentuales cada semana, y si el siguiente incremento está fuera de rango (como pasar de mancuernas de 10 a 15 lb), añade una rep a cada set en su lugar." Esto ES doble progresión: ~2.5%/semana como default razonable; cuando el incremento físico mínimo disponible sobrepasaría, añade reps hasta poder saltar de carga. **Redondeo a discos reales:** discos de 2.5 y 5 kg (raros de 1.25 kg); mancuernas comunes de 5, 10, 20 kg. El motor debe redondear al incremento físicamente disponible según el inventario configurable del usuario.

25. **RIR es fiable pero ruidoso, especialmente lejos del fallo.** Refalo et al. (2024): en sujetos entrenados, error medio de predicción de RIR fue 0.65 ± 0.78 reps a 1-3 RIR — alta precisión. PERO Zourdos et al. (2019/2021): la precisión cae lejos del fallo (error de ~2 reps a 1-RIR pero ~5 reps a 5-RIR). Steele et al. (2017): los entrenados subestiman por ~1-2 reps, los menos entrenados por ~4-5. **Implicación de diseño:** ancla la autorregulación al RIR pero trata la deriva de precisión de RIR como una métrica de calibración, y sé más conservador cuando el RIR objetivo está lejos del fallo.

26. **Parar 1-3 reps antes del fallo iguala la hipertrofia de llegar al fallo en entrenados.** Refalo MC, Helms ER, Robinson ZP, Hamilton DL, Fyfe JJ, *J Sports Sci* 2024;42(1):85-101 (DOI 10.1080/02640414.2024.2321021): "Hipertrofia muscular similar tras ocho semanas de entrenamiento de resistencia al fallo muscular momentáneo o con repeticiones en reserva en individuos entrenados." La banda 0-3 RIR con pendiente aplanada se confirma en Robinson ZP et al., *Sports Med* 2024;54(9):2209-2231 (DOI 10.1007/s40279-024-02069-2): "la hipertrofia mejora conforme los sets terminan más cerca del fallo" con pendiente positiva pero decreciente. Esto respalda la progresión RIR conservadora.

27. **Modelos de periodización — la evidencia dice que son equivalentes para hipertrofia.** Meta-análisis de Grgic J, Mikulic P, Podnar H, Pedisic Z (2017, *PeerJ*, DOI 10.7717/peerj.3695): la diferencia estandarizada agrupada (Cohen's d) de 13 estudios elegibles entre periodización lineal (LP) y ondulante diaria (DUP) sobre hipertrofia muscular fue **−0.02 (IC 95% [−0.25, 0.21], p = 0.848)** — "los efectos de los dos modelos de periodización sobre la hipertrofia muscular probablemente son similares". Bloque vs DUP también equivalentes para hipertrofia. **Implicación:** las 4 progresiones deben igualar volumen y esfuerzo; la elección es preferencia del usuario, no optimización.

28. **Proteína ~1.6 g/kg (Morton et al. 2018).** Morton RW et al., *Br J Sports Med* 2018;52:376-384 (DOI 10.1136/bjsports-2017-097608): "una meseta no ajustada en las ganancias de masa libre de grasa inducidas por entrenamiento a **1.62 g proteína/kg/día (IC 95%: 1.03 a 2.20)**... puede ser prudente recomendar ~2.2 g proteína/kg/d para quienes buscan maximizar las ganancias." Basado en 49 estudios, 1863 participantes; más eficaz en entrenados (+0.75 kg, p=0.03). El breakpoint es incierto y probablemente más alto para entrenados; trata 1.6 g/kg como piso, no techo. El autorreporte "proteína suficiente sí/no" a ~1.6 g/kg es un umbral razonable pero comunícalo como piso.

29. **Rotación de ejercicios (Kassiano et al. 2022, revisión sistemática).** Kassiano W, Nunes JP, Costa B, Ribeiro AS, Schoenfeld BJ, Cyrino ES, *J Strength Cond Res* 2022;36(6):1753-1762 (DOI 10.1519/JSC.0000000000004258): 8 estudios, N=241 (todos hombres jóvenes). "Cierta variación sistemática parece mejorar adaptaciones hipertróficas regionales y maximizar la fuerza dinámica, mientras que la variación excesiva y aleatoria puede comprometer las ganancias musculares" — relación en U invertida; "sigue siendo incierto si tal enfoque ofrece ventajas sobre una selección fija de ejercicios". RP recomienda mantener los mismos ejercicios durante todo el meso y cambiar solo por estancamiento, lesión o "staleness". **Implicación de diseño:** sugiere cambio de ejercicio solo al final del meso o cuando el performance de un ejercicio marcado como intercambiable se estanca — nunca rotación aleatoria frecuente.

30. **NO uses bombeo/dolor como métricas de progreso.** La literatura de RIR y volumen los trata como marcadores ruidosos de estímulo, no de progreso. Las métricas válidas de progreso son: carga levantada, reps a carga fija, y trayectoria de volumen completado.

## Details

### Cómo estructurar los DOS entregables

**Documento 1 — `CONTEXT.md` (PRD / especificación técnica).** Sin límite estricto de longitud (es referencia, no se carga cada sesión). Estructura recomendada (WHY/WHAT/HOW + SDD):
1. **Visión y no-objetivos.** App personal single-user de hipertrofia; PWA offline-first sin backend/login. No-objetivos explícitos: no multiusuario, no sync en la nube, no auth, no red social. (Los no-objetivos son críticos para agentes: evitan que "inventen" features.)
2. **Glosario de dominio.** MEV/MAV/MRV, RIR, mesociclo, deload, doble progresión, DUP, bloques — con definiciones operativas y remisión al documento científico existente vía `@`.
3. **Arquitectura.** Diagrama de capas: UI (React/shadcn) → estado (Zustand) → repository → Dexie/IndexedDB; y motor de dominio puro que lee `rules.config.json`. Regla de oro: el motor no importa React ni Dexie.
4. **Modelo de datos** (tablas Dexie): `exercises`, `muscles`, `baseWeek`, `mesocycles`, `sessions`, `setLogs`, `checkins`, `settings` (inventario de discos/mancuernas, perfil de experiencia, músculos priorizados).
5. **Features como historias verticales** (una por rebanada, cada una con criterios de aceptación testeables). Cubre las 10 funcionalidades del brief.
6. **Especificación algorítmica** de cada función pura (firmas, entradas/salidas, invariantes) — sección D arriba.
7. **Esquema del `rules.config.json`** y ejemplos de valores por perfil.
8. **Plan por fases con checklist** (milestones incrementales).

**Documento 2 — `CLAUDE.md` (bajo ~150 líneas, techo 300).** Contiene solo: descripción de 1-2 líneas; comandos (`dev`, `build`, `test`, `lint`, `typecheck`); mapa de directorios; convenciones no-default (ej. "el motor en `src/domain/` es funciones puras — NUNCA importar React ni Dexie ahí"; "toda la lógica científica lee de `rules.config.json`, NUNCA hardcodear umbrales"); gotchas (Serwist deshabilitado en dev; `reloadOnOnline: false`); workflow (plan mode para features multi-archivo; correr `typecheck` y tests del motor tras cambios); y `@imports` al PRD y al documento científico. Usa **IMPORTANT/YOU MUST** para las 2-3 reglas críticas (separación motor/UI; config JSON).

**Documento 3 (dato, no prosa) — `rules.config.json`.** Con `schemaVersion`. Es el que recalibras sin tocar código.

### Especificación de las 4 progresiones como funciones puras

Todas reciben `{ lastSessionLogs, targetRIR, repRange, availableIncrements, week, mesoConfig }` y devuelven `{ nextLoad, nextRepTarget, nextSets }`. Deben igualar volumen/esfuerzo entre sí (la evidencia dice que difieren en estructura, no en resultado):
- **Lineal:** sube carga cada sesión por el incremento mínimo disponible mientras se alcance el RIR objetivo con las reps objetivo.
- **Doble progresión (anclada a RIR):** dentro del rango de reps, sube reps hasta el tope del rango al RIR objetivo; al toparse, sube carga al incremento mínimo disponible y baja al piso del rango. Este es el core recomendado (coincide con la lógica de RP).
- **DUP:** varía carga/reps por día de la semana (ej. día pesado 5-10 reps, día medio 10-20, día ligero 20-30), igualando volumen semanal.
- **Bloques:** fases secuenciales (acumulación de volumen → intensificación) dentro del meso o a través de mesos.

### Redondeo de cargas (función pura crítica)

`roundToAvailable(targetLoad, { barWeight, plates[], dumbbells[], isBarbell })`: para barra, redondea al múltiplo alcanzable con pares de discos disponibles (paso mínimo = 2× disco más pequeño); para mancuernas, al escalón disponible más cercano. Cuando el salto mínimo excede el % objetivo, la progresión añade reps en su lugar. Inventario configurable por el usuario.

### Perfiles novato/medio/avanzado

Cada perfil ajusta tres cosas en `rules.config.json`: (a) volumen inicial (MEV) y techo (MRV) por músculo — más altos con más experiencia; (b) el modelo de progresión por defecto (novato: lineal, que exprime ganancias rápidas; medio/avanzado: doble progresión/DUP/bloques); (c) los umbrales de deload y la longitud del meso (avanzado: mesos más cortos, mayor volumen, se asume que conoce las consecuencias de mayor fatiga). En AVANZADO se prioriza la máxima hipertrofia (volumen hacia MRV, RIR más agresivo en las últimas semanas).

### Calendario impulsado por sesión

El estado del mesociclo avanza por **sesión completada**, no por fecha. El calendario es capa de agenda: si el usuario no entrena un día, la app corre los días (la sesión N sigue siendo la sesión N) o sugiere saltar según evidencia (la progresión no depende del calendario). Muestra un aviso neutral, no culpabilizador.

### Check-in neutral (feature 8)

Registra sueño (¿mínimo recomendado la noche previa? sí/no) y nutrición (proteína suficiente sí/no ~1.6 g/kg; balance energético superávit/mantenimiento/déficit). **NO modifica la sesión de forma refleja** — una noche de mal sueño es predictor ruidoso. Solo se registra para análisis longitudinal y como covariable de disparadores de deload. Tono neutral para evitar nocebo.

### Estadísticas de fin de ciclo (feature 10)

Progresión de carga por ejercicio/músculo; volumen completado vs. planeado; deriva de precisión de RIR (RIR estimado vs. reps reales al fallo cuando ocurra); trayectoria de fatiga (reps a carga fija a lo largo de semanas); adherencia. NO bombeo/dolor. Advertir explícitamente: **un solo ciclo tiene n pequeño; la calibración intra-sujeto requiere varios ciclos.**

## Recommendations

**Fase 0 — Prepara los documentos (antes de tocar código).**
1. Escribe `CONTEXT.md` (PRD) completo con las 8 secciones de arriba. Usa la técnica de Anthropic "deja que Claude te entreviste": arranca una sesión con "quiero construir [X], entrevístame en detalle con AskUserQuestion, luego escribe el spec en CONTEXT.md".
2. Escribe `rules.config.json` con valores iniciales por perfil (usa las cifras de la sección D como defaults).
3. Escribe `CLAUDE.md` corto (<150 líneas) con `@imports` a `CONTEXT.md` y al documento científico.
4. Corre `/init` para generar un CLAUDE.md base y fusiónalo con el tuyo.

**Fase 1 — Andamiaje y motor puro (primero lo testeable).**
5. Scaffolding: Next.js (static export) + TypeScript + Tailwind + shadcn/ui + Dexie + Zustand + Serwist.
6. Implementa el motor de dominio puro (`src/domain/`) que lee `rules.config.json`: las 4 progresiones, redondeo de carga, generación de mesociclo, disparadores de deload. **Escribe unit tests para cada regla** — este es el "check verificable" que Anthropic exige. Este es el milestone donde el enfoque spec-driven paga: define casos de test en el PRD.

**Fase 2 — Persistencia y UI, por rebanadas verticales.**
7. Implementa feature por feature como historias verticales (datos+lógica+UI), no capa por capa. Orden sugerido: (a) definir semana base + generar meso; (b) registro por serie durante entrenamiento + wake lock; (c) autorregulación de carga; (d) calendario; (e) check-in; (f) estadísticas de fin de ciclo.
8. Usa plan mode para cada feature multi-archivo; tras cada una, usa un subagente para revisión adversarial del diff contra el PRD.

**Fase 3 — PWA hardening.**
9. Configura Serwist (deshabilitado en dev, `reloadOnOnline: false`), manifest instalable, precache del app shell, y persistencia robusta (llama `navigator.storage.persist()` para evitar evicción de IndexedDB).
10. Prueba offline total en móvil real (DevTools → Application → Offline).

**Benchmarks que cambiarían las recomendaciones:**
- Si necesitaras sync multi-dispositivo en el futuro → Dexie Cloud (mismo API) o un backend; cambiaría la arquitectura de single-user a local-first con sync.
- Si el static export limitara algo → vuelve a Next.js con servidor, o migra a Vite.
- Si tras varios ciclos la deriva de RIR fuera grande → recalibra `rules.config.json` (sin tocar código) hacia RIR objetivos más conservadores.

## Caveats
- **La lógica interna exacta de la app de RP es propietaria.** La rúbrica de progresión de sets (sección D, punto 20) es la mejor aproximación pública documentada, no el algoritmo literal de RP. RP mismo dice que son "direcciones, no dogmas".
- **La evidencia de periodización es de corta duración** (estudios de 8-16 semanas, mayormente hombres jóvenes entrenados — la revisión de Kassiano tenía N=241, todos hombres jóvenes). Las diferencias entre modelos podrían existir a largo plazo pero no se detectan aún. No sobre-vendas la superioridad de ninguna progresión.
- **El breakpoint de proteína de 1.6 g/kg es incierto** y probablemente más alto para entrenados; trátalo como piso, con 2.2 g/kg como límite superior defendible.
- **RIR es ruidoso lejos del fallo**; la autorregulación basada en RIR es más fiable a 1-3 RIR que a 4-5 RIR.
- **Wake Lock puede ser denegado** por el SO (batería baja, modo ahorro); siempre maneja el rechazo con try/catch y feedback en UI.
- **Las cifras de longitud de CLAUDE.md (<300 líneas, idealmente <150)** vienen de guías de comunidad (HumanLayer, DataCamp) citando a Anthropic; la doc oficial dice "corto y legible" sin número exacto. La baja adherencia a instrucciones de CLAUDE.md se explica en parte por un `<system-reminder>` que Claude Code inyecta indicando que el contexto "puede o no ser relevante"; la cifra popular "~70%" sigue siendo estimación de comunidad, no oficial.
- Las cifras de rendimiento de PWA ("95% más rápido", "40% más engagement") provienen de blogs de marketing (Wellally) y deben tratarse como ilustrativas, no como benchmarks verificados.