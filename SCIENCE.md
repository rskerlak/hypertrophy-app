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
- **Autorregular no perjudica:** Hickmott 2022 (meta): autorregulación ≥ programación fija en fuerza, comparable en hipertrofia. → doble progresión anclada a RIR como default.
- **VBT:** lógica de "caída de rendimiento como proxy de fatiga" es aplicable sin encoder vía reps logradas. No se implementa VBT directo (sin hardware).

## 5. Deload
- **Coleman et al. 2024 (*PeerJ*, entrenados; coautores RP incl. Israetel):** una semana de cese **no mejoró hipertrofia** y **perjudicó algo la fuerza**; leve beneficio psicológico. Estudio en no entrenados (2026) similar. → El deload es **gestión de fatiga/articulaciones/adherencia, no potenciador anabólico**. Estructura: reducir volumen (a ~MEV/mitad), **mantener algo de carga** para no perder fuerza. `deloadStructure`.
- **Disparadores:** sin calendario fijo impuesto por evidencia. La caída de rendimiento es sobre todo **fatiga aguda**, no un "MRV superado" medible. → disparadores **probabilísticos y multi-señal**; fallback programado al fin de la acumulación. `deloadTriggers`.

## 6. Mesociclo
- Acumulación típica 4–6 semanas + 1 deload (RP); novatos toleran más (~8–12), avanzados menos (~3–4). No hay duración "óptima" demostrada. → `defaultAccumulationWeeks`/`maxAccumulationWeeks` por perfil.
- Rampa MEV→MAV/MRV: modelo RP, útil como estructura, **no demostrado superior** a volumen productivo constante (Barsuhn 2025). Por eso la rampa es suave y el volumen constante es una opción válida.

## 7. Periodización (los 4 modelos)
- **Grgic 2017 (*PeerJ*, 13 estudios): lineal vs DUP para hipertrofia, Cohen's d = −0.02 (IC 95% −0.25 a 0.21; p=0.848) → equivalentes.**
- **Moesgaard 2022 (*Sports Med*, volumen igualado): periodización sin efecto claro sobre hipertrofia (ES 0.13; IC −0.10 a 0.36; p=0.27).**
- → Los 4 modelos deben **igualar volumen y esfuerzo**; la elección es preferencia del usuario, no optimización. La UI no debe vender un modelo como superior para hipertrofia.

## 8. Selección de ejercicios y estiramiento
- **Rotación (Kassiano 2022, *JSCR*, revisión, N=241 hombres jóvenes):** variación sistemática moderada puede ayudar adaptaciones regionales; **variación excesiva/aleatoria compromete ganancias** (U invertida). RP: mantener ejercicios el meso, cambiar solo por estancamiento/lesión/staleness. → sugerir swap solo sobre `isSwappable` y ante estancamiento, nunca rotación frecuente.
- **Posición estirada (2022–2024):** entrenar en longitudes largas / parciales estiradas iguala o supera al ROM completo en varios estudios. **Contrapeso:** efecto moderado (~5–15%), evidencia reciente y de corta duración, mecanismo celular en humanos no firmemente establecido. → sesgo **prudente** hacia `resistanceProfile: "stretch"` en reemplazos; mejora plausible de bajo riesgo, no revolución.

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
