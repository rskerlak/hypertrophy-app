# Changelog

Cambios de MyoNoesis desde `4c43385`. Cada entrada nombra la tarea del plan
([`docs/plans/PLAN_A.md`](docs/plans/PLAN_A.md)) y el commit. Formato inspirado
en *Keep a Changelog*; la app no publica versiones numeradas (se despliega cada
push a `main`), así que se agrupa por fase.

## Correcciones de la auditoría de Plan A

### Motor (prescripción)
- **Lineal proporcional (H1):** si el salto mínimo del equipo supera el % por sesión, suma reps antes de subir carga (antes una polea de 5 kg saltaba +100 %).
- **Drop y parciales (H2):** ya no congelan la carga; deciden la progresión solo las series de trabajo/fallo a la carga de trabajo.
- Bloques re-anclan la carga al cambiar de fase (M2); peso corporal topea en 30 reps y sugiere lastre (M6); la continuación respeta APRE (M5); cambiar o reemplazar un ejercicio estima su propia carga (M3); el reemplazo no reescribe semanas entrenadas y un ejercicio con historial se archiva en vez de borrarse (M4); historial por slot cuando un ejercicio se repite en el día (S1).
- Números que faltaban en el config: tope del calendario de RIR, umbral de disposición, series y carga por defecto de un ejercicio nuevo (M7).

### Sesión y offline
- **Offline real (UX-01):** las páginas se precachean y una sesión nunca abierta funciona sin red; `npm run test:offline` en CI.
- **Doble toque (UX-02):** "Log" ignora el rebote y editar una serie registrada pide confirmación.
- Timer siempre visible, toast que no tapa toques, controles de 44 px, "última vez" de la misma pista, la carga cambiada pasa a la serie siguiente, hojas con Escape y foco atrapado (UX-03…UX-08).
- En libras, tocar un campo sin editarlo ya no altera cargas ni discos (M1).

### Seguridad
- Respaldo validado por completo con topes y límite de 25 MB; se importa la salida validada; pantalla de error con exportar/importar (S-01…S-03, S-07).
- CSP por meta, Next 15.5.29, workflows con acciones fijadas por SHA y sin credenciales persistidas, `.gitignore` para temporales y respaldos, `serve` solo en localhost (S-04…S-06, S-09, S-12, S-13, S-14).
- Pendiente del lado de la cuenta (no es código): verificar el dominio en GitHub Pages y proteger `main` (S-06, S-10).
- **Dependencias con avisos aceptados:** `xlsx` (SheetJS 0.18) tiene avisos solo en el camino de **lectura** de planillas; la app únicamente **escribe** el Excel de exportación, así que no es explotable aquí. `zod` 3 tiene un aviso de memoria con colecciones grandes: el respaldo se valida fila por fila cortando en el primer error, y cada lista (también las anidadas) chequea su largo antes de validar sus elementos (R-02).

### Re-auditoría
- Bloques en peso corporal ya no re-anclan (N1/N2): el re-anclaje corre solo si cambió la fase entre la última sesión y la actual.
- El reemplazo de un ejercicio no reescribe los días ya entrenados de una semana a medias (N3); los errores de inventario en Ajustes avisan (N4); tests de swap sin candidatos y de disposición baja (N5).
- Toast sin capturar toques (UX-04), timer "Listo" opaco (UX-R1), fila de la serie sin solapes a 360–390 px (UX-23), la carga heredada no se pierde por tocar reps (UX-R2), "(hoy)" en vez de "(hace hoy)".
- `overrides` de sesión validados en el respaldo (R-01) y validación fila por fila con memoria acotada (R-02). La CSP se aplica solo en el build (R-04).

## Plan A · A4 — Robustez, datos y pulido

### Agregado
- **Respaldo seguro (A4.1).** Cada fila del respaldo se valida con Zod antes de
  borrar nada; el error nombra tabla, fila y campo (`setLogs[12].actualReps: reps
  fuera de rango`). Antes de importar se descarga automáticamente una copia del
  estado actual (`myonoesis-pre-import-…json`). Formato de respaldo v2; se siguen
  importando los v1.
- **Borrado seguro de ejercicios (A4.2).** Si el ejercicio está en la semana base
  o en un meso sin terminar, hay que elegir un reemplazo; el historial se conserva
  y Stats/Excel lo muestran como «(ejercicio eliminado)».
- **Perfiles de gimnasio (A4.5).** Varios inventarios (Principal, Casa, Hotel…);
  se eligen en Ajustes o desde la sesión ("Hoy entreno en"). El inventario actual
  se migra al perfil «Principal».
- **Unidad de carga kg/lb (A4.7).** Solo de visualización: todo se guarda en kg.
- **Diálogos propios (A4.6).** Reemplazan `confirm`/`alert`/`prompt` nativos:
  foco atrapado, Escape, `aria-modal`, foco devuelto al cerrar. Toasts no
  bloqueantes.
- **Auditoría de accesibilidad (A4.6).** `npm run test:a11y` corre axe-core sobre
  12 pantallas en tema claro y oscuro y sobre el diálogo; workflow propio en CI.
- **Plan: edición segura (A4.4).** Ids estables por slot, mínimo ≤ máximo forzado
  en el rango de reps, carga inicial desde tu historial al agregar un ejercicio,
  duplicar día, confirmación al borrar, aviso al generar si se pausa el meso activo.

### Cambiado
- **Actualizaciones (A4.3).** El service worker nuevo espera (`skipWaiting:
  false`) y se activa solo al tocar "actualizar"; con una sesión en curso pregunta
  y permite posponerlo hasta terminarla.
- **Contraste AA.** Tokens de "tinta" para texto en color (`--primary-ink`,
  `--danger-ink`) y verdes/ámbar más oscuros en tema claro.

### Corregido
- Un músculo sin landmarks en el config (ej. ejercicio propio) ya no rompe la
  generación del meso: se trata como "sin objetivo" y mantiene el volumen base.

## Plan A · A3 — Historial y análisis (`26a66c6`)
- Vista por ejercicio `/exercise?id=` con e1RM y carga tope por sesión y por pista.
- Agenda real: fecha de inicio y días al generar, vista mensual, aviso de atraso
  con la recomendación real de correr o saltar, reabrir saltadas.
- Stats: reporte de la semana, adherencia a la carga prescrita, buscador, deuda
  de sueño vs reps a carga fija (n ≥ 6, asociación, no causa).
- Medidas: tendencia de peso por media móvil exponencial.

## Plan A · A2 — Motor (`05de9a8`, `4d4697a`)
- Disparadores de deload con peso y fatiga percibida; deload por ejercicio;
  "descargar ahora".
- Serie ancla, APRE (bloqueado en barra libre sin seguros), tope blando de 11
  series fraccionadas por sesión, sugerencia entre series, confianza en el RIR
  según carga y serie, 1RM dependiente de la carga como opción.
- Selector de "Nuevo meso": de cero, desde la semana actual o desde rutinas
  precargadas.

## Plan A · A1 — Pantalla de sesión (`abe4ced`, `3fd1742`, `dffb39b`, `918cda9`)
- Discos por lado, calentamiento, "última vez", récords, chip "¿por qué?" con la
  regla del motor, superseries, timer anclado a la última serie, cambiar ejercicio
  solo hoy o en el plan, ± series, notas, reabrir sesión.
- RIR explícito en la última serie de cada ejercicio (A1.11): en datos reales el
  99 % del RIR registrado era el valor precargado.

## Plan A · A0 — Correcciones del motor (`8bce5a1` … `99bd79a`)
- `targetLoadKg` guarda la carga prescrita (antes copiaba la real).
- El deload no progresa y aplica la carga de la segunda mitad.
- Stats excluyen deload y sesiones saltadas y se separan por pista.
- La caída de rendimiento se compara contra el mismo día del split; nunca se
  sugiere deload durante el deload.
- Citas corregidas en SCIENCE.md; detección de RIR "eco".

## `df90c0b`, `4c43385`
- Planes A/B y protocolo de auditoría.
- Botón para anotar bugs (viajan en el respaldo), barra inferior oculta al tipear,
  rutina de 5 días fuerte/liviano y banda de RIR 1–3.
