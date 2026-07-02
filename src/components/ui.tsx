// Primitivas de UI ligeras (Tailwind). Mobile-first, tema oscuro.
"use client";

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

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
        onClick && "cursor-pointer active:opacity-80",
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
    primary: "bg-[var(--primary)] text-[var(--primary-fg)] active:opacity-85",
    secondary: "bg-[var(--surface-2)] text-[var(--foreground)] border border-[var(--border)] active:opacity-80",
    ghost: "text-[var(--muted)] active:text-[var(--foreground)]",
    danger: "bg-[var(--danger)] text-white active:opacity-85",
  };
  const sizes: Record<string, string> = {
    sm: "h-9 px-3 text-sm",
    md: "h-11 px-4 text-[15px]",
    lg: "h-13 px-5 text-base",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:opacity-40",
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
        "h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-[var(--muted)]", className)}>{children}</label>;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[15px] text-[var(--foreground)] outline-none focus:border-[var(--primary)]",
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
    primary: "bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/30",
    success: "bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30",
    warning: "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30",
    danger: "bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-xs text-sm text-[var(--muted)]">{hint}</p>}
      {action}
    </Card>
  );
}

/** Nota de honestidad epistémica: heurístico / n pequeño / etc. */
export function HonestNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-[var(--muted)]">
      <span aria-hidden>ⓘ</span>
      <span>{children}</span>
    </p>
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
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => onChange(Math.max(min, +(value - step).toFixed(3)))} className="w-11 shrink-0 text-lg">
        −
      </Button>
      <div className="min-w-[72px] flex-1 text-center text-lg font-semibold tabular-nums">
        {format ? format(value) : value}
        {suffix && <span className="ml-1 text-sm font-normal text-[var(--muted)]">{suffix}</span>}
      </div>
      <Button variant="secondary" size="sm" onClick={() => onChange(+(value + step).toFixed(3))} className="w-11 shrink-0 text-lg">
        +
      </Button>
    </div>
  );
}
