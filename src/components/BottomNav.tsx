"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

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
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-50 pb-[max(env(safe-area-inset-bottom),12px)]">
      <div className="pointer-events-auto mx-auto flex w-[calc(100%-32px)] max-w-[420px] items-stretch justify-around rounded-3xl border border-[var(--border)] bg-[#101014]/85 px-1.5 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl">
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
