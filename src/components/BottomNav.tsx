"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

const items = [
  { href: "/", label: "Hoy", icon: "◉" },
  { href: "/calendar", label: "Calendario", icon: "▦" },
  { href: "/plan", label: "Plan", icon: "▤" },
  { href: "/stats", label: "Stats", icon: "▨" },
  { href: "/settings", label: "Ajustes", icon: "⚙" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                active ? "text-[var(--primary)]" : "text-[var(--muted)]",
              )}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
