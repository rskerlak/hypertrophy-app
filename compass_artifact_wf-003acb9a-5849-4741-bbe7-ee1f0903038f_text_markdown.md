# Motor de cálculo para una app de hipertrofia basada en evidencia: diseño, ciencia y crítica al modelo RP

## TL;DR
- **La evidencia revisada por pares sostiene con firmeza tres palancas** (volumen semanal con retornos decrecientes, proximidad al fallo 0–3 RIR, y ~2x/semana de frecuencia), pero **NO valida directamente los constructos MEV/MAV/MRV ni la teoría de "repeticiones efectivas"** de Renaissance Periodization: son heurísticas plausibles y útiles para programar, no cantidades medidas. Tu app debe tratarlas como parámetros ajustables por feedback, no como verdades fisiológicas.
- **El motor de cálculo debería basarse en autorregulación por rendimiento** (reps logradas vs programadas a un RIR objetivo) más que en detectar un "MRV" preciso: la evidencia muestra que la doble progresión con RIR objetivo, rampa suave de volumen desde un punto conservador, y descargas periódicas o autorreguladas capturan casi todo el beneficio demostrado, con mucha menos pretensión de precisión que la app de RP.
- **La mayor limitación honesta**: la caída de rendimiento intra-mesociclo se debe mayormente a fatiga aguda/gestión de esfuerzo, no es un marcador validado de "haber superado el MRV"; y estudios recientes en entrenados (Barsuhn et al. 2025, *J Appl Physiol*; Enes et al. 2024, *MSSE*) muestran que "más volumen no siempre es mejor" y que mantener el volumen habitual puede igualar o superar a subirlo. Diseña el motor para ser humilde y empírico por usuario.

## Key Findings

1. **Volumen**: relación dosis-respuesta positiva con retornos decrecientes y **sin techo claramente identificado** para hipertrofia (a diferencia de la fuerza, que sí muestra meseta pronunciada). ~4 series semanales fraccionadas es la dosis mínima efectiva; 5–10 el rango más eficiente (Pelland et al. 2026, *Sports Med*).
2. **Fallo/RIR**: la hipertrofia mejora ligeramente al acercarse al fallo (relación positiva pero aplanada), mientras la fuerza es indiferente al RIR. Entrenar a 0–3 RIR captura el estímulo; ir al fallo no es necesario y penaliza la recuperación.
3. **Rangos de reps/carga**: hipertrofia similar en ~5–30+ reps (≈30–85% 1RM) con esfuerzo equiparado. La carga es una variable secundaria para hipertrofia.
4. **Frecuencia**: sin efecto significativo sobre hipertrofia con volumen igualado; es un vehículo para distribuir volumen, no un estímulo per se.
5. **Periodización**: lineal, ondulante (DUP) y por bloques producen hipertrofia equivalente con volumen igualado. Ningún modelo es superior para hipertrofia.
6. **Descargas**: fundamento fisiológico razonable pero evidencia directa limitada y ambivalente (Coleman et al. 2024 mostró que cesar puede perjudicar la fuerza sin beneficiar la hipertrofia).
7. **"Effective reps" y MEV/MRV**: constructos teóricos no validados directamente; útiles como andamiaje, riesgosos si se tratan como mediciones.
8. **Individualización**: variabilidad inter-individual real y grande; la mejor herramienta es el diseño intra-sujeto/ensayo-error autorregulado, no fórmulas poblacionales.

## Details

### 1. Modelos de progresión de carga y volumen

**Sobrecarga progresiva.** El principio central está sólidamente respaldado, pero el *método* de progresión importa poco cuando el volumen y el esfuerzo se igualan. Los enfoques principales:
- **Progresión lineal** (subir carga cada sesión): funciona en novatos; se agota rápido en intermedios/avanzados.
- **Doble progresión** (primero subir reps dentro de un rango, luego carga): el método más práctico y robusto para hipertrofia; se adapta naturalmente a un objetivo de RIR.
- **Periodización ondulante diaria (DUP)** vs **lineal (LP)**: el meta-análisis de Grgic et al. (2017, *PeerJ*, 13 estudios) encontró diferencia esencialmente nula para hipertrofia (Cohen's d = −0.02; IC 95% [−0.25, 0.21], p=0.848). Cuando el volumen se iguala, ningún modelo supera al otro para hipertrofia.
- **Periodización por bloques**: el meta-análisis de Moesgaard et al. (2022, *Sports Medicine*) sobre programas con volumen igualado no encontró efecto claro de la periodización sobre hipertrofia (ES 0.13; IC 95% [−0.10, 0.36]; p=0.27); la periodización sí ayuda a la *fuerza* pero no de forma significativa a la hipertrofia.

**Conclusión para el motor**: elige el modelo de progresión por conveniencia y adherencia, no por un supuesto beneficio hipertrófico. La doble progresión con RIR objetivo es la opción por defecto óptima.

**Modelos de progresión de volumen.** Aquí está la controversia más relevante para tu app:
- El **modelo RP de rampa** (empezar en MEV, subir series semana a semana hacia MRV, descargar) es la práctica popular, pero la evidencia experimental directa es débil y mixta.
- **Enes, De Souza & Souza-Junior (2024, *Med Sci Sports Exerc* 56(3):553-563)**: 31 hombres entrenados (edad 24.4±2.9 años, experiencia RT 5.1±2.2 años), 12 semanas, tren inferior 2×/sem. Grupo constante (CG, n=10, mantiene 22 series/sem) vs progresión +4 series/2sem (4SG, n=10) vs +6 series/2sem (6SG, n=11). La fuerza mostró clara dosis-respuesta (6SG>4SG>CG), pero la **hipertrofia NO tuvo diferencias significativas entre grupos**. Cita textual: *"Cross-sectional area and sum of lateral thigh muscle thickness showed no between-group differences (P = 0.067 and P = 0.076, respectively)"*, con aparente meseta en los volúmenes más altos. Los autores concluyen con cautela: *"our findings indicate a possible small benefit for higher volume conditions regarding hypertrophic adaptations in this population, the limited certainty of our findings warrants caution."*
- **Barsuhn et al. (2025, *J Appl Physiol* 138(1):259-269, doi:10.1152/japplphysiol.00476.2024)**: 55 hombres entrenados aleatorizados, 29 completaron (CON n=10, G30 n=10, G60 n=9), 8 semanas, tren inferior 2×/sem. Mantener volumen habitual (CON, ~12 series/sem) vs +30% (~19) vs +60% (~25). **Sin diferencias en hipertrofia**; el grupo de mantenimiento numéricamente ganó *más* grosor muscular (ΔΣMT: CON 1.07 cm vs G30 0.76 cm, G60 0.70 cm) y tuvo mayor 1RM en sentadilla (174.7 kg vs G30 159.0 kg, G60 149.0 kg; efecto de grupo P=0.0268). Cita verbatim (New & Noteworthy): *"these findings suggest that more is not always better for muscle adaptations in a trained cohort, highlighting muscle growth across a wide range of weekly set numbers."*

**Implicación crítica**: la premisa RP de que hay que rampar el volumen agresivamente cada semana para maximizar hipertrofia **no está demostrada**; en bloques cortos de entrenados, mantener un volumen suficiente puede igualar o superar a subirlo. La rampa de volumen tiene sentido como gestión de fatiga y como forma de *encontrar* el volumen productivo individual, no como una ley dosis-respuesta semana a semana.

### 2. Variables de volumen (marco RP vs evidencia)

**Los landmarks (MV/MEV/MAV/MRV).** Son un marco heurístico creado por Mike Israetel/RP. Definiciones: MV = volumen de mantenimiento; MEV = volumen mínimo efectivo; MAV = volumen adaptativo máximo (rango óptimo); MRV = volumen máximo recuperable. **Ninguno ha sido medido o validado directamente en la literatura revisada por pares como un umbral fisiológico discreto.** Son conceptos organizadores útiles, pero tu app no debe presentarlos como cantidades conocidas por músculo. Los rangos que circulan (p. ej. MEV ~6–8, MAV ~12–20, MRV ~20+ series) provienen de guías de RP, no de mediciones.

**La relación dosis-respuesta real.** Aquí la evidencia es fuerte y es lo que debe anclar el motor:
- **Pelland, Remmert, Robinson, Hinson & Zourdos (2026, *Sports Medicine* 56(2):481-505, epub 4 dic 2025, doi:10.1007/s40279-025-02344-w; meta-regresión, 67 estudios, 2058 sujetos)**: probabilidad posterior del 100% de que la hipertrofia aumenta con el volumen; retornos decrecientes pero **sin meseta identificada** para hipertrofia (contraste: la fuerza sí muestra meseta pronunciada). Dosis mínima efectiva ≈ **4 series semanales fraccionadas**; máxima eficiencia 5–10 series; eficiencia intermedia 11–18; menor eficiencia 19–29; datos escasos por encima de ~25–30. Pendiente marginal: *"estimated a 0.24% increase in hypertrophy (95% CrI: 0.15, 0.33) per additional set at the average 'fractional' weekly volume of 12.25 sets."* Sobre el techo: *"no se identificó una meseta clara en la relación dosis-respuesta; sin embargo, hay incertidumbre adicional en volúmenes más altos."*
- **Cuantificación "fraccionada"**: cuenta cada serie directa como 1 y cada serie indirecta (sinergista) como 0.5. Este método superó a "total" y "directo" (Bayes Factors). Los autores lo describen como *"una heurística para mejorar la precisión del modelado dosis-respuesta, no un estándar definitivo"*.
- **¿Existe techo? ¿Más es siempre mejor?** A nivel meta-analítico, no hay techo demostrado y más volumen tiende a más hipertrofia *en promedio*, pero con retornos decrecientes marcados y datos escasos y ruidosos por encima de ~25–30 series. A nivel de RCT individual en entrenados (Enes 2024, Barsuhn 2025), volúmenes muy altos NO superaron claramente a volúmenes moderados. Stronger by Science (Greg Nuckols, "More Training, More Gaining", 2025) argumenta que la posición de "bajo volumen es óptimo" (≤10 series) no tiene apoyo directo, pero también reconoce alta incertidumbre en el extremo alto. **Postura recomendada: la mayoría de los usuarios progresan bien en 10–20 series fraccionadas/semana/músculo; subir más ofrece beneficios marginales inciertos y un coste de fatiga real.**

**"Junk volume".** El concepto (series lejos del fallo o de calentamiento no cuentan como estímulo) es coherente con que la proximidad al fallo importa para hipertrofia, pero el umbral exacto (p. ej. "solo cuentan series a ≤4 RIR") es una regla práctica, no un hallazgo medido.

**Distribución (frecuencia).** Ver puntos 4 y 7: con volumen igualado la frecuencia es indiferente para hipertrofia. Distribuir el volumen en 2 sesiones/semana por músculo es una guía razonable para permitir calidad de series, no un requisito hipertrófico.

### 3. Intensidad y proximidad al fallo

**Rangos de reps y carga.** El meta-análisis de Schoenfeld, Grgic, Ogborn & Krieger (2017, *JSCR*) mostró hipertrofia equivalente entre cargas bajas (≤60% 1RM) y altas (>60% 1RM) cuando se entrena cerca del fallo; la diferencia de tamaño de efecto fue trivial (0.03; IC −0.16 a 0.22). La fuerza sí favorece cargas altas. El re-examen de Schoenfeld & Grgic (2021, *Sports*, "repetition continuum") confirma que la hipertrofia se logra en un amplio espectro de cargas. **Implicación**: un rango amplio (~5–30 reps) es válido para hipertrofia; deja que el usuario elija carga por preferencia/articulaciones, contando series a esfuerzo suficiente.

**Proximidad al fallo — la evidencia clave para el motor:**
- **Refalo et al. (2022, *Sports Medicine*; meta-análisis, 15 estudios)**: ventaja trivial del fallo vs no-fallo (ES=0.19; IC [0.00, 0.37]; p=0.045); sin ventaja significativa del fallo momentáneo en subanálisis (ES=0.12; p=0.343). Sugiere relación **no lineal**.
- **Robinson et al. (2024, *Sports Medicine* 54(9):2209-2231; meta-regresión, 55 estudios hipertrofia / 67 fuerza)**: la hipertrofia aumenta al acercarse al fallo (pendiente respecto a RIR con IC que no contiene cero) pero con curva que se aplana; la fuerza es indiferente al RIR (IC contiene cero). Conclusión: el RIR influye meaningfully en hipertrofia pero no en fuerza.
- **Refalo et al. (2024, *J Sports Sci*; RCT, 8 semanas, entrenados)**: fallo vs 1–2 RIR produjo hipertrofia de cuádriceps similar.

**Síntesis para el motor**: prescribe la mayoría de series a **0–3 RIR** (típicamente 1–2 RIR), acercándose al fallo en las últimas semanas del bloque. No es necesario ni recomendable entrenar todo al fallo: penaliza recuperación y volumen sostenible sin beneficio hipertrófico claro.

**"Repeticiones efectivas / estimulantes".** Teoría (popularizada por Chris Beardsley): solo las ~5 reps finales antes del fallo, con reclutamiento máximo de unidades motoras y velocidad de contracción lenta, estimulan hipertrofia. **Estado científico: NO validada; probablemente incorrecta en su forma fuerte.** Greg Nuckols (Stronger by Science, "The Evidence is Lacking for Effective Reps") documenta que la evidencia es deficiente: si solo importaran ~5 reps efectivas, series de <5 reps deberían crecer menos y no lo hacen, y el modelo no predice bien los datos reales de rangos de reps. Es una simplificación mecanicista atractiva pero sin apoyo empírico directo. **Para tu app**: puedes usar "series a proximidad suficiente al fallo" como criterio de volumen efectivo (respaldado indirectamente por Robinson 2024), pero NO construyas el motor sobre un conteo literal de "reps efectivas" — sería edificar sobre teoría no probada.

### 4. Autorregulación

**RPE/RIR.** Validez razonable pero imperfecta. Estudios de Zourdos, Helms, Refalo, Remmert: la precisión del RIR mejora (a) más cerca del fallo, (b) en series posteriores, (c) con cargas más altas/reps más bajas, y (d) con familiarización previa llevando series al fallo real. A intensidades bajas/altas reps la gente subestima mucho las reps restantes (p. ej. Ferrari et al.: a 60% 1RM los sujetos subestimaron el "RIR 3" en 4–8 reps; a 80% fue preciso). Remmert, Laurson & Zourdos (2023): la precisión del RIR no difirió por sexo ni experiencia en ejercicios monoarticulares, pero sí mejoró cerca del fallo. **El RIR es una herramienta válida para prescribir esfuerzo, pero el motor debe asumir un error de ±1–2 reps y calibrarlo por usuario.**

**Velocity-based training (VBT).** Jukic et al. (2023, *Sports Medicine*): mayores umbrales de pérdida de velocidad (más fatiga/proximidad al fallo) favorecen la hipertrofia (b=0.006; IC [0.001, 0.012]); menores umbrales favorecen potencia/velocidad. Jukic et al. (2024, *Physiological Reports*): la relación RIR-velocidad *individual* (no la general) predice el RIR con error <2 reps. **Para una app sin encoders**, el VBT no es directamente aplicable, pero su lógica (usar caída de rendimiento como proxy de proximidad al fallo y de fatiga) sí lo es a través de las reps logradas.

**Autorregulación por feedback de rendimiento.** El meta-análisis de Hickmott et al. (2022, *Sports Medicine Open*) sobre autorregulación de carga/volumen mostró mejoras similares o ligeramente superiores frente a programación fija en fuerza, y resultados comparables en hipertrofia — es decir, autorregular no perjudica y aporta flexibilidad. **Este es el corazón del motor**: ajustar carga sesión a sesión mediante doble progresión anclada al RIR objetivo, usando las reps efectivamente logradas.

**Lógica algorítmica concreta (recomendación):**
- Define para cada ejercicio un **rango de reps** (p. ej. 8–12) y un **RIR objetivo** decreciente en el mesociclo (semana 1: 3 RIR; última semana de acumulación: 0–1 RIR).
- **Doble progresión**: si el usuario alcanza el tope del rango de reps al RIR objetivo, sube la carga (~2.5–5% o el mínimo incremento disponible) la próxima sesión y vuelve al fondo del rango.
- Si las reps logradas al RIR objetivo caen respecto a la sesión previa con la misma carga, mantén o reduce ligeramente; una caída sostenida (2+ sesiones) es señal de fatiga acumulada.
- **Estimación de 1RM/carga** desde reps y RIR (ecuación tipo Epley ajustada por RIR) para sugerir el peso inicial de cada ejercicio.

### 5. Gestión de fatiga y descargas

**Fundamento.** Fatiga acumulada y supercompensación son marcos fisiológicos ampliamente aceptados, pero la evidencia de que las descargas *mejoran* la hipertrofia es limitada.
- **Coleman et al. (2024, *PeerJ* 12:e16777; entrenados, 9 semanas; coautores incluyen Israetel, Androulakis-Korakakis, Schoenfeld)**: una semana de descarga (cese total) a mitad del programa **no mejoró la hipertrofia** y **perjudicó ligeramente las ganancias de fuerza** de tren inferior frente a entrenar continuo; hubo leve beneficio psicológico (readiness to train).
- El estudio en no entrenados (Scientific Reports 2026, diseño intra-sujeto) halló resultados parecidos: la descarga (reducción de volumen/frecuencia) no benefició la hipertrofia.

**Cuándo programar descargas.** La evidencia no impone un calendario fijo. Práctica común y defendible: descarga cada 4–6 semanas de acumulación *o* autorregulada por marcadores. Dado que las descargas no potencian la hipertrofia demostrablemente, su función principal es **gestión de fatiga, salud articular y adherencia**, no un "reset" anabólico mágico.

**Cómo estructurarla.** Reducir volumen (p. ej. ~50% de series) manteniendo algo de intensidad/carga es la aproximación más conservadora para preservar rendimiento (dado que el cese total penalizó la fuerza en Coleman). Duración típica 5–7 días.

**Indicadores rastreables por la app** (todos son señales imperfectas, no diagnósticos): caída de reps logradas al RIR objetivo con la misma carga en múltiples sesiones; aumento del RIR reportado a cargas fijas; dolor articular persistente; sueño/estrés autoinformados; disminución de la "disposición a entrenar". La app debe tratar estos como *disparadores probabilísticos* de descarga, no como prueba de haber "superado el MRV".

### 6. Estructura de mesociclo y macrociclo

- **Duración de bloques de acumulación**: 4–6 semanas es la práctica habitual; no hay una duración "óptima" demostrada. Bloques de ~8–12 semanas también funcionan en la investigación.
- **Secuenciación** (acumulación → intensificación → realización → descarga): tomada del entrenamiento de fuerza; para hipertrofia pura la evidencia de que la secuenciación importa es débil (ver punto 1).
- **Rampa MEV→MRV**: es el modelo RP; útil como estructura de gestión de fatiga y de descubrimiento del volumen individual, pero **no demostrado como superior a mantener un volumen productivo constante** (Barsuhn 2025). Recomiendo implementarla como rampa *suave* y opcional, con el objetivo real de encontrar el volumen productivo del usuario por ensayo autorregulado, no de perseguir un MRV teórico.

### 7. Selección de ejercicios y frecuencia

**Frecuencia.** Schoenfeld, Grgic & Krieger (2019, *J Sports Sci*/meta-análisis, 25 estudios): **sin diferencia significativa en hipertrofia con volumen igualado** entre frecuencias; conclusión textual: los individuos pueden elegir la frecuencia semanal por preferencia. (El meta-análisis previo de Schoenfeld 2016 favorecía 2x/sem, pero estaba confundido por volumen no igualado.) Entrenar cada músculo ~2x/semana es una guía práctica útil (permite distribuir volumen y calidad de series), no un requisito hipertrófico.

**Compuestos vs aislamiento y variación.**
- Ambos son válidos; los compuestos son eficientes en tiempo, los de aislamiento permiten dirigir regiones específicas. Baz-Valle et al. (2019, *PLoS One*): con volumen igualado en entrenados, solo el grupo con ejercicios *fijos* hizo crecer significativamente el vasto intermedio, mientras que la variación aleatoria constante no; la variación sí mejoró la motivación.
- **Revisión sistemática de Kassiano et al. (2022, *JSCR*)**: *"algún grado de variación sistemática parece mejorar las adaptaciones hipertróficas regionales... mientras que la variación excesiva y aleatoria puede comprometer las ganancias."* Guía: variación moderada y con propósito (por región/perfil), no rotación aleatoria constante.
- Para cubrir un músculo completo (todas sus regiones/cabezas) conviene 2+ ejercicios con distintos perfiles de resistencia.

**Rango de movimiento y posición estirada (evidencia 2022–2024).**
- Wolf, Androulakis-Korakakis, Fisher, Schoenfeld & Steele (2023, meta-análisis de ROM, *Int J Strength Cond*) y estudios de Pedrosa (2022/2023), Kassiano, Maeo, Sato (2021): entrenar en **longitudes musculares largas / posición estirada** produce hipertrofia igual o mayor que el ROM completo, y superior al ROM acortado. Las **parciales en posición estirada (lengthened partials)** igualan o superan al ROM completo en varios estudios (Wolf et al. 2025, *PeerJ*, entrenados: adaptaciones similares al ROM completo).
- **Contrapeso honesto**: Stronger by Science ("Do Lengthened Partials Really Stimulate Stretch-Mediated Hypertrophy?") advierte que el efecto es moderado (~5–15% en estudios que detectan diferencia), la evidencia de "hipertrofia mediada por estiramiento" a nivel celular en humanos es aún limitada (la sarcomerogénesis documentada en humanos es sobre todo con protocolos excéntricos, p. ej. Andrews et al. 2024 en bíceps femoral), y muchos estudios son cortos. Recomendación: **sesgar la selección de ejercicios hacia estímulo en estiramiento profundo** y opcionalmente añadir parciales estiradas — mejora plausible y de bajo riesgo, no una revolución probada.

**Distribución de volumen entre ejercicios.** Reparte el volumen del músculo entre 2–4 ejercicios con perfiles de resistencia complementarios; evita concentrar todo en un solo patrón si el objetivo es desarrollo completo del músculo.

### 8. Individualización

- **Variabilidad inter-individual**: grande y real (respondedores altos/bajos documentados: Räntilä et al. 2021, *JSCR*; revisión de Roberts/Haun sobre biogénesis ribosomal, células satélite, receptores de andrógenos). Sin embargo, parte de la "variabilidad" reportada es error de medición y variación biológica temporal, no verdadera respuesta individual (Robinson et al. 2024, "N of 1", *Sports Med*; diseños intra-sujeto unilaterales). **Implicación clave para la app**: no confíes en fórmulas poblacionales de volumen; usa el historial del propio usuario como referencia (enfoque intra-sujeto).
- **Nivel de experiencia**: los novatos progresan con poco volumen y progresión lineal de carga; los avanzados necesitan más volumen/variedad y progresan más lento. El MEV/MRV "aumentan" con la experiencia según RP — plausible pero no medido con precisión.
- **Moduladores de recuperación**: sueño, nutrición (proteína/energía) y estrés psicológico afectan la recuperación y la respuesta. La app puede recoger sueño/estrés/dolor como covariables para modular disparadores de descarga y ajustes de volumen, entendiendo que son señales ruidosas.

### 9. Consideraciones de diseño para el motor de cálculo

**Inputs a registrar (por serie/sesión):**
- Peso, reps completadas, RIR estimado (obligatorios).
- Ejercicio y músculos objetivo (para calcular series directas=1 / indirectas=0.5).
- Feedback post-sesión opcional: bombeo, dolor muscular (DOMS), dolor articular, disposición a entrenar, sueño/estrés. (RP usa pump, soreness, joint pain, performance.)

**Lógica algorítmica recomendada (síntesis basada en evidencia):**
1. **Carga/peso siguiente**: doble progresión anclada al RIR objetivo. Estima 1RM por serie con una ecuación reps+RIR; sugiere el peso que caiga en el rango de reps al RIR objetivo. Sube carga cuando se supera el tope del rango al RIR objetivo.
2. **Volumen semanal**: parte de un volumen conservador-pero-efectivo (p. ej. ~8–12 series fraccionadas/músculo/semana, dentro del rango eficiente de Pelland) y ramplo suavemente (+1–2 series/músculo/semana) solo si el rendimiento y el feedback lo permiten. Cap práctico ~20 series salvo evidencia individual de beneficio.
3. **Contar volumen como series fraccionadas** (directas 1, sinergistas 0.5), siguiendo el método de Pelland et al. — es la cuantificación con mejor apoyo meta-analítico.
4. **Detección de "exceso de volumen/fatiga"**: dispara descarga cuando concurran (no uno solo): caída de reps al RIR fijo ≥2 sesiones, aumento de RIR a carga fija, dolor articular alto, disposición baja. **Preséntalo como probabilístico, no como "MRV alcanzado".**
5. **Descarga**: ~50% del volumen, mantener carga/intensidad moderada, 5–7 días; o descarga por tiempo (cada 4–6 semanas) configurable.
6. **Calibración individual**: registra la respuesta del usuario (progresión de cargas, grosor si lo mide, fatiga) mesociclo a mesociclo y ajusta el volumen inicial del siguiente bloque según su historial, no según tablas poblacionales.

**Comparación crítica con la app de RP Hypertrophy:**
- **Qué hace bien**: autorregula el volumen por feedback (pump, soreness, joint pain, performance); implementa progresión de RIR (típicamente 3→0 en 4–6 semanas) con descarga; ofrece plantillas y estructura; traduce principios (SRA, sobrecarga progresiva, gestión de fatiga) en acción. Es un producto coherente y educativo, y ha generado investigación propia (Coleman 2024).
- **Limitaciones**: (a) trata MEV/MAV/MRV y el conteo de "series estimulantes" como si fueran cantidades conocidas, cuando son heurísticas no validadas; (b) su rampa de volumen asume una relación dosis-respuesta semanal que los RCTs en entrenados (Enes 2024, Barsuhn 2025) no confirman; (c) usa feedback subjetivo (bombeo, dolor) como disparadores, y el dolor/pump son marcadores pobres de estímulo/hipertrofia; (d) empieza muy bajo (usuarios reportan 2 series/músculo iniciales) lo que muchos encuentran subóptimo; (e) es de suscripción y opaca en su algoritmo.
- **Qué mejorar en tu app**: (1) anclar el motor en **rendimiento objetivo** (reps logradas al RIR objetivo) más que en sensaciones subjetivas; (2) ser transparente y humilde: mostrar rangos e incertidumbre, no números falsamente precisos; (3) usar el **historial intra-sujeto** para individualizar en vez de tablas poblacionales; (4) tratar la descarga como gestión de fatiga configurable, no como potenciador anabólico; (5) sesgar la selección de ejercicios hacia estímulo en estiramiento; (6) permitir volumen constante productivo como opción válida (no forzar rampa).

## Recommendations

**Etapa 1 — MVP del motor (implementar ya, alto respaldo):**
- Doble progresión con RIR objetivo por ejercicio; rango de reps 5–30 a elección.
- RIR objetivo decreciente en el mesociclo (3→0–1) y descarga cada 4–6 semanas (volumen −50%, mantener carga).
- Conteo de volumen en series fraccionadas (directas 1, sinergistas 0.5).
- Volumen inicial conservador (~8–12 series fraccionadas/músculo/sem), 2 sesiones/músculo/sem por defecto.

**Etapa 2 — autorregulación por rendimiento:**
- Estimador de 1RM por reps+RIR para sugerir cargas.
- Detección de fatiga multi-señal (rendimiento + feedback) como disparador probabilístico de descarga.
- Rampa de volumen suave y opcional, guiada por rendimiento sostenido.

**Etapa 3 — individualización longitudinal:**
- Ajuste del volumen inicial del siguiente bloque según el historial del usuario.
- Sesgo de selección hacia estiramiento; variación sistemática por región.
- Covariables de recuperación (sueño/estrés) como moduladores.

**Umbrales que cambiarían las recomendaciones:**
- Si aparecen RCTs grandes en entrenados que demuestren beneficio hipertrófico claro de rampas de volumen agresivas → intensificar la rampa.
- Si se valida un marcador objetivo de MRV (biomarcador o caída de rendimiento estandarizada) → sustituir el disparador probabilístico por uno cuantitativo.
- Si nuevos meta-análisis confirman un techo de volumen → añadir un cap duro.

## Caveats
- **MEV/MAV/MRV y "effective reps" son constructos heurísticos no validados directamente**; útiles para estructurar, peligrosos si se presentan como mediciones.
- **La caída de rendimiento intra-bloque refleja mayormente fatiga aguda**, no un "MRV superado" medible; los disparadores de descarga son probabilísticos.
- **Los RCTs clave en entrenados son pequeños** (Enes 2024 n=31; Barsuhn 2025 n=29 completaron de 55 aleatorizados, alta deserción y sin análisis de potencia a priori por COVID; p-valores de hipertrofia >0.05) — sus conclusiones ("más no siempre es mejor", "meseta") son sugestivas, no definitivas.
- **El dolor muscular (DOMS) y el bombeo son marcadores pobres** de estímulo hipertrófico; el DOMS disminuye con la adaptación y no indica mejor sesión.
- **La mayoría de la evidencia de volumen alto (>25–30 series) es escasa y ruidosa**; extrapolar a volúmenes extremos es especulativo (los propios autores de Pelland advierten incertidumbre por encima de ~25 series fraccionadas).
- **La evidencia de estiramiento/lengthened partials es prometedora pero reciente y de duración corta**; el mecanismo celular en humanos no está firmemente establecido.
- Casi toda la evidencia citada es en hombres jóvenes/adultos, consistente con el objetivo del usuario, pero limita la generalización a otras poblaciones.