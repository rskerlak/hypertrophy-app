# SCIENCE.md — Fundamento científico del motor

> Justifica cada número y regla de `rules.config.json`. Distingue lo **sólidamente respaldado** de lo **heurístico/no validado**. Prioriza evidencia revisada por pares. El agente no necesita leer esto para codear, pero sí para entender por qué la app comunica incertidumbre donde lo hace.

## Regla epistémica de oro
- **Sólido (respaldado por meta-análisis/RCTs):** relación dosis-respuesta del volumen con retornos decrecientes; hipertrofia similar en ~5–30 reps con esfuerzo equiparado; banda 0–3 RIR captura el estímulo; frecuencia indiferente con volumen igualado; modelos de periodización equivalentes para hipertrofia.
- **Heurístico (útil, NO medido):** MEV/MAV/MRV como umbrales discretos; conteo de "sets efectivos"; "effective reps" en su forma fuerte (probablemente incorrecta). Se usan como andamiaje de programación, no como verdades.
- **Diseño en consecuencia:** el motor se ancla en **rendimiento observado** (reps al RIR objetivo) e historial intra-sujeto, no en detectar un "MRV" preciso.

## 1. Volumen (ancla del motor)
- **Pelland et al. 2026, *Sports Medicine* (meta-regresión, 67 estudios, 2058 sujetos):** la hipertrofia aumenta con el volumen (prob. posterior 100%), con **retornos decrecientes y sin meseta clara identificada**; ~0.24% más hipertrofia por set adicional en el volumen medio (~12 sets/sem). Dosis mínima efectiva ≈ **4 sets fraccionados/sem**; máxima eficiencia 5–10; datos escasos y ruidosos > ~25–30. → Justifica MEV bajos, rampa hacia MAV, y **cap prudente ~20 sets** salvo evidencia individual.
- **Conteo fraccionado (directo 1.0, sinergista 0.5):** superó a "total"/"directo" en Pelland. → `volumeCounting`.
- **Contrapeso honesto (RCTs en entrenados):** Enes 2024 (*MSSE*, n=31) y Barsuhn 2025 (*J Appl Physiol*, n=29 completaron) NO hallaron ventaja hipertrófica clara de volúmenes altos vs. moderados; Barsuhn: mantener el volumen habitual igualó o superó a subirlo. → "más no siempre es mejor"; la rampa sirve para **encontrar** el volumen productivo individual y gestionar fatiga, no como ley semanal. Por eso el perfil intermedio empieza en MEV y rampa con `aggressiveness < 1`.

## 2. MEV/MAV/MRV (heurística RP)
Constructos de Israetel/RP, **no medidos como umbrales fisiológicos**. Los valores en `volumeLandmarksBase` provienen de guías públicas de RP; incertidumbre alta, sobre todo MRV. Suben con la experiencia (de ahí `volumeMultiplier` por perfil). La app debe etiquetarlos como heurísticos y dejar que el historial los recalibre.

## 3. Intensidad, rango de reps y proximidad al fallo
- **Rango de reps:** Schoenfeld 2017 / Schoenfeld & Grgic 2021: hipertrofia equivalente en ~5–30 reps (≈30–85% 1RM) con esfuerzo equiparado. La carga es secundaria para hipertrofia. → `repRanges`, `globalValid 5–30`.
- **Proximidad al fallo:** Refalo 2022 (*Sports Med*, meta): ventaja del fallo trivial (ES 0.19) y no significativa en fallo momentáneo. Robinson 2024 (*Sports Med*, meta-regresión): hipertrofia mejora al acercarse al fallo pero **la curva se aplana**; la fuerza es indiferente al RIR. Refalo 2024 (*J Sports Sci*, RCT 8 sem, entrenados): 1–2 RIR igualó al fallo en hipertrofia. → Progresión de RIR conservadora: mayoría a 0–3 RIR, acercándose al fallo al final del meso. `rirSchedule`.
- **"Effective reps" (forma fuerte):** no validada, probablemente incorrecta (Nuckols/SBS: si solo importaran ~5 reps finales, sets de <5 reps crecerían menos y no lo hacen). → **No** construir el motor sobre conteo literal de reps efectivas; usar "sets a proximidad suficiente al fallo".

## 4. Autorregulación (corazón del motor)
- **RIR fiable pero ruidoso:** Refalo 2024: error ~0.65±0.78 reps a 1–3 RIR (preciso). Zourdos 2019/2021: precisión cae lejos del fallo (~error 2 reps a 1-RIR vs ~5 reps a 5-RIR). Steele 2017: entrenados subestiman ~1–2 reps; menos entrenados ~4–5. → El motor ancla en RIR pero es más conservador lejos del fallo, y la **deriva de precisión de RIR** es una métrica de calibración (stats).
- **Autorregular no perjudica (pero tampoco es superior):** Hickmott 2022 (meta): autorregulación ≥ programación fija en fuerza, comparable en hipertrofia. Meta 2022 (PMID 35038063): la autorregulación de carga (RPE/RIR o VBT) **no** dio ventaja significativa de fuerza sobre porcentajes fijos (MD 2.07 kg, IC −0.32 a 4.46; p=0.09). Una red-meta 2025 halló ventaja de **APRE** (SMD −0.83 banca) pero **no** de RIR/RPE (IC cruzan cero). → la app usa doble progresión anclada a RIR por transparencia y practicidad, y **no debe venderla como óptima**.
- **Cuánto confiar en el RIR reportado (calibra `rirAdjustmentCapReps`):**
  - Refalo 2024 (entrenados, n=18): error absoluto <1 rep tanto a 1-RIR como a 3-RIR, pero el **SD casi se duplica** al alejarse del fallo (0.51–0.78 → 0.70–1.16), y el signo se invierte (sobreestima a 1-RIR, subestima a 3-RIR). → tope de ±2 reps ≈ 2 SD del peor caso.
  - Halperin/Zourdos 2023 (18 sesiones de banca): la precisión **no mejora con la práctica** dentro del bloque, y existe **deriva sistemática** de −0.077 reps/sesión (~1.4 reps acumuladas). → el tope es fijo; no se afloja "porque el usuario aprendió".
  - Mismo trabajo: el error **crece con las reps del set** (−0.404 reps por rep adicional). → en rangos altos el tope baja (`rirAdjustmentCapRepsHighRep` a partir de `rirAdjustmentHighRepThreshold`).
  - Precisión mejor en series posteriores de la sesión y sin efecto de sexo/experiencia en monoarticulares en máquina (Sagepub 2023).
  - Criterio de puerta propuesto por los propios autores: recién con error ≤1 rep del objetivo tiene sentido prescribir en la banda 0–2 RIR. → implementado en `rirCalibration`: el motor mide tu precisión y recorta su propia confianza (tope ±1 y piso de 1 RIR) mientras no estés calibrado.
  - **Umbral realista (Larsen 2025):** en entrenados el error basal a 3-RIR ronda **1–1.5 reps** y los autores lo consideran ya aceptable (sentadilla −1.5±1.7; banca −1.1±1.8), con sesgo sistemático a **subestimar** la reserva (podés más de lo que creés). → `wellCalibratedMadReps: 1.5`; exigir ≤1.0 sería más estricto que el estado del arte.
  - **La variación de proximidad al fallo ENTRENA la precisión (valida el `rirSchedule`):** con un esquema que varía el RIR semana a semana (4→3→2→1) el error cayó de −1.5±1.7 a −0.6±1.4 en sentadilla y de −1.1±1.8 a −0.1±0.9 en banca (p<0.05/0.01); con RIR constante en 1 **no** hubo mejora significativa. → el calendario descendente de la app no es solo dosificación de fatiga: además calibra al usuario.
  - **La precisión NO depende de la experiencia** (p=0.462) ni de haber usado RIR antes. → calibrar **por individuo con sus propios datos**, nunca asignar confianza por perfil de experiencia.
  - **Limitación honesta del método de la app:** el protocolo validado mide la precisión con tests periódicos al 80% 1RM donde el usuario canta 3-RIR y 1-RIR y **sigue hasta el fallo**. La app usa un proxy sin test al fallo (dispersión de la capacidad implícita `reps + RIR` a carga fija), que es una **cota superior** del ruido porque incluye fluctuación real de rendimiento. Sirve para graduar confianza, no para afirmar el error verdadero. Mejora futura: ofrecer un test AMRAP opcional.
  - El RIR reportado **lejos del fallo es de baja información** (revisión de 26 estudios, 2025: la precisión cae al alejarse del fallo, con más reps y con menor %1RM; también es peor en tren inferior que superior). → el ajuste se atenúa a la mitad desde `highRirDampenFrom` (4 RIR).
- **VBT:** lógica de "caída de rendimiento como proxy de fatiga" es aplicable sin encoder vía reps logradas. No se implementa VBT directo (sin hardware). Meta 2022: para hipertrofia, umbrales de pérdida de velocidad >20–25% superaron a ≤20% (MD 0.64 cm²; p=0.03), atribuido a **volumen relativo acumulado** más que a la proximidad al fallo en sí.

## 5. Deload
- **Coleman et al. 2024 (*PeerJ*, entrenados; coautores RP incl. Israetel):** una semana de cese **no mejoró hipertrofia** y **perjudicó algo la fuerza**; leve beneficio psicológico. Estudio en no entrenados (2026) similar. → El deload es **gestión de fatiga/articulaciones/adherencia, no potenciador anabólico**. Estructura: reducir volumen (a ~MEV/mitad), **mantener algo de carga** para no perder fuerza. `deloadStructure`.
- **Disparadores:** sin calendario fijo impuesto por evidencia. La caída de rendimiento es sobre todo **fatiga aguda**, no un "MRV superado" medible. → disparadores **probabilísticos y multi-señal**; fallback programado al fin de la acumulación. `deloadTriggers`.

## 6. Mesociclo
- Acumulación típica 4–6 semanas + 1 deload (RP); novatos toleran más (~8–12), avanzados menos (~3–4). No hay duración "óptima" demostrada. → `defaultAccumulationWeeks`/`maxAccumulationWeeks` por perfil.
- Rampa MEV→MAV/MRV: modelo RP, útil como estructura, **no demostrado superior** a volumen productivo constante. Por eso el default (`volumeRamp.mode: "finalWeeksBump"`) mantiene el volumen de la semana base y solo agrega un empujón acotado en la última semana.
- **Evidencia MIXTA sobre rampar series (leerla completa, no solo la mitad conveniente):**
  - *A favor de volumen constante:* Barsuhn 2025 (*J Appl Physiol*): mantener el volumen habitual igualó o superó a +30%/+60%; el grupo control tuvo el mayor Δ grosor sumado del muslo (1.07 cm vs 0.76 y 0.70). Enes 2024 (*MSSE*): rampar +4/+6 series cada 2 semanas **no** dio diferencias de hipertrofia (CSA p=0.067; ΣMT p=0.076) — la ventaja clara fue en **fuerza** (1RM sentadilla: +6 > +4 > constante).
  - *A favor de rampar:* RCT 2025 en mujeres entrenadas (PMID 39869076): la progresión de series superó al volumen constante en 1RM de prensa, y **solo la rampa más agresiva** (+4 series/2 semanas) superó a constante en CSA del vasto lateral; el efecto **no replicó** en grosor sumado.
  - *Lectura honesta:* una rampa mínima como la del default ("+1 serie/ejercicio solo la última semana") está **débilmente respaldada en el mejor de los casos** para hipertrofia; el volumen constante sí lo está. La rampa agresiva tiene respaldo sobre todo para **fuerza**. Por eso el modo `linear` sigue disponible y la elección se documenta como preferencia, no como optimización.
- **Techo de series POR SESIÓN: no hay evidencia.** Pelland 2026 no halla efecto fiable de la **frecuencia** sobre hipertrofia con volumen igualado, así que "fraccionar en más días" no está demostrado superior a apilar en una sesión. El tope `maxExtraSetsPerSlotPerWeek` es una **heurística práctica** (tiempo, fatiga local, adherencia, datos escasos >25–30 series/semana), explícitamente **no** una regla fisiológica.

## 7. Periodización (los 4 modelos)
- **Grgic 2017 (*PeerJ*, 13 estudios): lineal vs DUP para hipertrofia, Cohen's d = −0.02 (IC 95% −0.25 a 0.21; p=0.848) → equivalentes.**
- **Moesgaard 2022 (*Sports Med*, volumen igualado): periodización sin efecto claro sobre hipertrofia (ES 0.13; IC −0.10 a 0.36; p=0.27).**
- → Los 4 modelos deben **igualar volumen y esfuerzo**; la elección es preferencia del usuario, no optimización. La UI no debe vender un modelo como superior para hipertrofia.

## 8. Selección de ejercicios y estiramiento
- **Rotación (Kassiano 2022, *JSCR*, revisión, N=241 hombres jóvenes):** variación sistemática moderada puede ayudar adaptaciones regionales; **variación excesiva/aleatoria compromete ganancias** (U invertida). RP: mantener ejercicios el meso, cambiar solo por estancamiento/lesión/staleness. → sugerir swap solo sobre `isSwappable` y ante estancamiento, nunca rotación frecuente.
- **Posición estirada (2022–2024):** entrenar en longitudes largas / parciales estiradas iguala o supera al ROM completo en varios estudios. **Contrapeso:** efecto moderado (~5–15%), evidencia reciente y de corta duración, mecanismo celular en humanos no firmemente establecido. → sesgo **prudente** hacia `resistanceProfile: "stretch"` en reemplazos; mejora plausible de bajo riesgo, no revolución.

## 8 bis. Qué recortar cuando el volumen sobra (`volumeTrim`)
Cuando un músculo pasa su MAV heurístico, la app no pinta todo por igual: marca **anclas** (conservar) y **prescindibles** (candidatos a recortar). Base y límites de cada regla:
- **Recortar primero lo redundante.** Kassiano 2022 (*JSCR*) es lo más cercano a un criterio publicado: el criterio para variar debe ser **anatómico/biomecánico** (perfil de resistencia, longitud muscular, énfasis regional) y **no variedad por sí misma**; un estímulo redundante se describe como potencialmente contraproducente, no solo neutro. → los duplicados del mismo perfil son los primeros candidatos.
- **Preferir longitudes largas / posición estirada.** Maeo 2022: tríceps en overhead produjo 1.4–1.5× más hipertrofia que en neutro **a igual volumen** y con 34–39% menos carga absoluta (el mecanismo no es la carga). Pedrosa 2022: parciales a longitud larga superaron al ROM completo en varias regiones del cuádriceps, mientras que los parciales en **posición acortada** no se distinguieron del grupo control en algunas regiones. → el perfil `stretch` se conserva primero y el `short` **no recibe slot protegido**.
- **Contrapeso que evita sobre-vender la variedad:** un ensayo 2025 en flexores de codo **no** halló ventaja de *mezclar* longitudes frente a consolidar todas las series en longitud larga, y un meta-análisis de 12 estudios encontró efectos **triviales** (SMD 0.04–0.09, IC cruzando cero) de la longitud sobre la hipertrofia *regional*. → cubrir estirado/medio sí; "coleccionar perfiles" no está demostrado. La app conserva variedad mínima, no máxima.
- **Aporte directo antes que sinergista:** el trabajo indirecto ya viene de otro patrón; recortarlo cuesta menos estímulo específico. (Heurística de conteo fraccionado, no un hallazgo aparte.)
- **Orden en la sesión/semana:** los primeros ejercicios se ejecutan con menos fatiga acumulada. Criterio práctico, sin respaldo fuerte y directo para hipertrofia.
- **No rotar por rotar:** la relación variedad↔adaptación es una **U invertida**; cambiar ejercicios seguido puede comprometer ganancias. → los swaps siguen disparándose solo por estancamiento (§8).

## 8 ter. Psicología (secundario, no rige la prescripción)
No es la prioridad del motor, pero condiciona la adherencia y por eso está reflejado en la UI:
- **Metas de proceso, no de resultado:** la app prescribe "hacé 12 reps a RIR 2" y muestra el *por qué* de cada decisión (`rationale`), en vez de fijar metas de resultado a largo plazo.
- **Autonomía:** el motor **sugiere** y nunca ejecuta cambios solo — deloads sugeridos, recortes señalados, swaps propuestos. La decisión siempre queda en el usuario.
- **Progreso objetivo visible:** e1RM por ejercicio, reps a carga fija, adherencia y volumen completado. Sin métricas de vanidad (bombeo/dolor), que además son marcadores pobres de estímulo (§11).
- **Riesgo a vigilar:** una autorregulación muy estricta puede empujar al sub-esfuerzo (parar antes por miedo a "pasarse de RIR"). Mitigación en la app: el RIR reportado **nunca bloquea** la sesión, el tono es neutral, y el sesgo medido (que en entrenados es a subestimar la reserva) se muestra en Stats para que sea visible.

## 9. Frecuencia
- **Schoenfeld 2019 (*J Sports Sci*, meta, 25 estudios): con volumen igualado, la frecuencia no afecta significativamente la hipertrofia.** → ~2×/semana por músculo es guía práctica para distribuir volumen y calidad de series, no un requisito. La app permite elegir frecuencia libremente.

## 10. Nutrición y sueño (covariables, no modificadores de sesión)
- **Proteína (Morton 2018, *BJSM*, 49 estudios): meseta ~1.62 g/kg/día (IC 1.03–2.20); ~2.2 g/kg como techo defendible.** Breakpoint incierto, probablemente más alto en entrenados. → 1.6 como **piso**, no techo. Autoreporte simple, no contador de macros.
- **Sueño:** una noche mala es predictor **ruidoso y débil** del rendimiento de esa sesión; pesa más la deuda crónica y el estrés sostenido. → registrar para tendencia, **no recortar la sesión**; el árbitro honesto es el rendimiento real (reps al RIR objetivo).

## 11. Métricas (qué sí, qué no)
- **Válidas:** carga estimada, reps a carga fija (fatiga), volumen completado vs planeado, deriva de RIR, adherencia.
- **Vanidad (excluir):** bombeo y dolor muscular son marcadores **pobres** de estímulo/hipertrofia; el DOMS baja con la adaptación y no indica mejor sesión.

## Caveats generales
- Casi toda la evidencia es en hombres jóvenes/adultos entrenados (consistente con el usuario objetivo), lo que limita generalización.
- Los RCTs clave en entrenados son pequeños (n≈29–31, alta deserción, p>0.05 en hipertrofia): sus conclusiones son sugestivas, no definitivas.
- La lógica interna exacta de la app de RP es propietaria; las rúbricas aquí son la mejor aproximación pública, no el algoritmo literal de RP.
- Un solo mesociclo tiene **n pequeño**: no permite establecer tu dosis-respuesta personal ni atribuir causas ("el mal sueño me tanqueó") — eso es indistinguible de ruido. La calibración real emerge tras varios ciclos.
