// Primitivas de UI ligeras (Tailwind). Mobile-first, tema claro/oscuro, acento lima.
"use client";

import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4",
        onClick && "cursor-pointer transition-transform duration-150 active:scale-[0.985] active:opacity-90",
        className,
      )}
    >
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  const variants: Record<string, string> = {
    primary:
      "bg-[var(--primary)] text-[var(--primary-fg)] shadow-[0_0_28px_var(--primary-glow)] active:shadow-none",
    secondary:
      "bg-[var(--surface-2)] text-[var(--foreground)] border border-[var(--border)] active:bg-[var(--surface)]",
    ghost: "text-[var(--muted)] active:text-[var(--foreground)]",
    danger: "bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/25",
  };
  const sizes: Record<string, string> = {
    sm: "h-9 px-4 text-sm",
    md: "h-11 px-5 text-[15px]",
    lg: "h-13 px-6 text-base",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-35 disabled:shadow-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[15px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted)]/70 focus:border-[var(--primary)]/50 focus:ring-2 focus:ring-[var(--primary)]/15",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]",
        className,
      )}
    >
      {children}
    </label>
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cn(
        "h-11 w-full appearance-none rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[15px] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 focus:ring-2 focus:ring-[var(--primary)]/15",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]",
    primary: "bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/25",
    success: "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/25",
    warning: "bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/25",
    danger: "bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-3">
      <div>
        {subtitle && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]/80">
            {subtitle}
          </p>
        )}
        <h1 className="text-[28px] font-bold leading-none tracking-tight">{title}</h1>
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed py-12 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="max-w-xs text-sm leading-relaxed text-[var(--muted)]">{hint}</p>}
      {action}
    </Card>
  );
}

/** Nota de honestidad epistémica: heurístico / n pequeño / etc. */
export function HonestNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-2xl border border-[var(--border)] bg-transparent p-3.5 text-xs leading-relaxed text-[var(--muted)]">
      <span aria-hidden className="text-[var(--primary)]/70">
        ⓘ
      </span>
      <span>{children}</span>
    </p>
  );
}

/**
 * Número editable a mano (además de los botones +/- que lo rodean).
 * Acepta coma o punto decimal; confirma al salir del campo o con Enter.
 */
export function EditableNumber({
  value,
  onChange,
  min = 0,
  format,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  format?: (v: number) => string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null) {
      const n = parseFloat(draft.replace(",", "."));
      if (Number.isFinite(n)) onChange(Math.max(min, n));
    }
    setDraft(null);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={draft ?? (format ? format(value) : String(value))}
      onFocus={(e) => {
        setDraft(String(value));
        // seleccionar todo para reemplazar de un tipeo
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cn(
        "rounded-lg bg-transparent text-center tabular-nums outline-none focus:bg-[var(--surface-2)] focus:ring-2 focus:ring-[var(--primary)]/25 disabled:opacity-40",
        className,
      )}
    />
  );
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  suffix,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
  format?: (v: number) => string;
}) {
  const btn =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-xl font-medium transition-transform active:scale-90";
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, +(value - step).toFixed(3)))}>
        −
      </button>
      <div className="min-w-[72px] flex-1 text-center text-xl font-bold tabular-nums tracking-tight">
        {format ? format(value) : value}
        {suffix && <span className="ml-1 text-sm font-medium text-[var(--muted)]">{suffix}</span>}
      </div>
      <button type="button" className={btn} onClick={() => onChange(+(value + step).toFixed(3))}>
        +
      </button>
    </div>
  );
}
