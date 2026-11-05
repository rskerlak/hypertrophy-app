"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

/** Campos que abren el teclado del celular (no selects ni checkboxes). */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "file", "range", "color"].includes(type);
}

/**
 * Cuándo esconder la barra. En iOS un elemento `position: fixed` queda
 * "suelto" a mitad de pantalla mientras el teclado está abierto, y a veces
 * sigue desplazado después de cerrarlo hasta el próximo scroll. Por eso:
 *  - se oculta mientras hay un campo de texto con foco o el teclado abierto
 *    (visualViewport más bajo que la ventana);
 *  - al cerrar el teclado se fuerza un re-layout para que vuelva al borde;
 *  - en la sesión de entrenamiento se esconde al bajar y reaparece al subir,
 *    para no tapar los botones de Log mientras se entrena.
 */
function useNavHidden(autoHideOnScroll: boolean): boolean {
  const [typing, setTyping] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (isTypingTarget(e.target)) setTyping(true);
    };
    const onFocusOut = () => {
      // Esperar a que el foco aterrice en el siguiente campo (Tab / "siguiente").
      setTimeout(() => {
        if (isTypingTarget(document.activeElement)) return;
        setTyping(false);
        // iOS: re-layout para que los elementos fixed vuelvan a su lugar.
        window.scrollTo(window.scrollX, window.scrollY);
      }, 60);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    const vv = window.visualViewport;
    const onViewport = () => {
      if (!vv) return;
      // Teclado abierto ≈ el viewport visible perdió más de un cuarto de alto.
      setKeyboard(vv.height < window.innerHeight * 0.75);
    };
    vv?.addEventListener("resize", onViewport);
    onViewport();

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", onViewport);
    };
  }, []);

  useEffect(() => {
    setScrolledAway(false);
    if (!autoHideOnScroll) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 4;
      if (y < 80) setScrolledAway(false);
      else if (y > lastY + 6 && !nearBottom) setScrolledAway(true);
      else if (y < lastY - 6) setScrolledAway(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [autoHideOnScroll]);

  return typing || keyboard || scrolledAway;
}

function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

// Paths estilo lucide (24×24, stroke).
const ICONS = {
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  calendar: "M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  plan: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  stats: "M6 20v-6m6 6V10m6 10V4",
  settings: "M21 7h-8M7 7H3m18 10h-4m-6 0H3m7-13v6m4 4v6",
};

const items = [
  { href: "/", label: "Hoy", icon: ICONS.zap },
  { href: "/calendar", label: "Agenda", icon: ICONS.calendar },
  { href: "/plan", label: "Plan", icon: ICONS.plan },
  { href: "/stats", label: "Stats", icon: ICONS.stats },
  { href: "/settings", label: "Ajustes", icon: ICONS.settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const hidden = useNavHidden(pathname.startsWith("/session"));
  return (
    <nav
      data-hidden={hidden || undefined}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-50 pb-[max(env(safe-area-inset-bottom),12px)] transition-[transform,opacity] duration-200 ease-out",
        hidden && "translate-y-[calc(100%+16px)] opacity-0",
      )}
    >
      <div className="pointer-events-auto mx-auto flex w-[calc(100%-32px)] max-w-[420px] items-stretch justify-around rounded-3xl border border-[var(--border)] bg-[var(--glass)] px-1.5 py-1.5 shadow-[var(--pop-shadow)] backdrop-blur-xl">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-[10px] font-semibold tracking-wide transition-colors duration-150",
                active
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--muted)] active:text-[var(--foreground)]",
              )}
            >
              <Icon d={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
