"use client";

// Guía visual de medidas: silueta humana (SVG de líneas, sin assets externos)
// con una banda punteada que marca por dónde pasa la cinta según el campo
// activo del formulario. La mitad izquierda se dibuja una vez y se espeja
// para garantizar simetría.

const HALF_BODY =
  "M92 54 C92 62 90 64 84 66 C70 70 58 74 54 84 " + // cuello → hombro
  "C50 92 48 112 45 138 C43 158 41 176 40 194 L50 196 " + // brazo externo → mano
  "C52 178 55 160 58 142 C61 126 64 110 66 98 " + // brazo interno → axila
  "C70 112 72 130 73 148 C72 162 69 174 67 186 " + // costado del torso → cadera
  "C66 208 69 232 73 256 C74 274 72 288 73 300 C74 318 76 332 77 344 " + // pierna externa
  "L95 344 " + // pie
  "C94 328 93 312 93 298 C92 282 93 268 94 256 C96 236 98 216 100 202"; // pierna interna

interface BandDef {
  el: React.ReactNode;
  label: string;
  tip: string;
}

const BAND_STYLE = {
  fill: "rgba(197,247,79,0.10)",
  stroke: "var(--primary)",
  strokeOpacity: 1,
  strokeWidth: 2.5,
  strokeDasharray: "5 4",
} as const;

const GUIDES: Record<string, BandDef> = {
  heightCm: {
    label: "Altura",
    tip: "Descalzo, contra la pared, talones juntos y mirando al frente.",
    el: (
      <g stroke="var(--primary)" strokeOpacity={1} strokeWidth={2.5}>
        <line x1={168} y1={18} x2={168} y2={344} strokeDasharray="5 4" />
        <line x1={160} y1={18} x2={176} y2={18} />
        <line x1={160} y1={344} x2={176} y2={344} />
        <path d="M164 26 L168 18 L172 26 M164 336 L168 344 L172 336" fill="none" />
      </g>
    ),
  },
  bodyweightKg: {
    label: "Peso",
    tip: "En ayunas o siempre a la misma hora, con la misma ropa (o sin).",
    el: (
      <g>
        <rect x={62} y={350} width={76} height={8} rx={4} {...BAND_STYLE} />
      </g>
    ),
  },
  waistCm: {
    label: "Cintura",
    tip: "Horizontal a la altura del ombligo, abdomen relajado, sin apretar la cinta.",
    el: <ellipse cx={100} cy={150} rx={28} ry={6} {...BAND_STYLE} />,
  },
  chestUnderShouldersCm: {
    label: "Torso bajo hombros",
    tip: "Alrededor del torso, justo debajo de las axilas, con la cinta paralela al piso.",
    el: <ellipse cx={100} cy={102} rx={36} ry={7} {...BAND_STYLE} />,
  },
  shoulderGirthCm: {
    label: "Torso con hombros",
    tip: "Por el punto más ancho de los hombros (deltoides), con los brazos colgando relajados.",
    el: <ellipse cx={100} cy={82} rx={49} ry={9} {...BAND_STYLE} />,
  },
  bicepCm: {
    label: "Bíceps",
    tip: "En el punto más grueso del brazo. Relajado o flexionado, pero siempre igual.",
    el: (
      <ellipse cx={53} cy={116} rx={10} ry={4.5} transform="rotate(-14 53 116)" {...BAND_STYLE} />
    ),
  },
  quadCm: {
    label: "Cuádriceps",
    tip: "A mitad del muslo, de pie, con el peso repartido en las dos piernas.",
    el: <ellipse cx={83} cy={232} rx={14} ry={5} {...BAND_STYLE} />,
  },
  calfCm: {
    label: "Gemelo",
    tip: "En el punto más ancho de la pantorrilla, de pie.",
    el: <ellipse cx={85} cy={304} rx={10.5} ry={4.5} {...BAND_STYLE} />,
  },
};

const DEFAULT_TIP =
  "Tocá un campo y la figura te muestra por dónde pasa la cinta. Medí siempre en las mismas condiciones (misma hora, sin bombeo): la consistencia importa más que la precisión.";

export function MeasurementGuide({ active }: { active: string | null }) {
  const guide = active ? GUIDES[active] : undefined;

  return (
    <div className="sticky top-2 z-10 mb-1 flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-[#101014]/95 p-3 backdrop-blur">
      <svg
        viewBox="0 0 200 372"
        className="h-40 w-auto shrink-0"
        fill="none"
        stroke="var(--muted)"
        strokeOpacity={0.55}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx={100} cy={36} r={18} />
        <path d={HALF_BODY} />
        <path d={HALF_BODY} transform="scale(-1,1) translate(-200,0)" />
        {guide && <g stroke="none">{guide.el}</g>}
      </svg>
      <div className="min-w-0">
        {guide ? (
          <>
            <p className="text-sm font-semibold text-[var(--primary)]">{guide.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{guide.tip}</p>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-[var(--muted)]">{DEFAULT_TIP}</p>
        )}
      </div>
    </div>
  );
}
