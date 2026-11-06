// Diálogos propios (A4.6): reemplazan confirm()/alert() nativos, que en una PWA
// instalada se ven fuera de lugar, no respetan el tema y bloquean el hilo.
// API imperativa: `if (await askConfirm({...})) …`. Lo dibuja <DialogHost/>.

import { create } from "zustand";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: botón en rojo. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  kind: "confirm" | "alert" | "prompt";
  /** Valor inicial (prompt). */
  initial?: string;
  resolve: (ok: boolean, value?: string) => void;
}

interface Toast {
  id: number;
  message: string;
  tone: "neutral" | "success" | "danger";
}

interface DialogState {
  queue: PendingConfirm[];
  toasts: Toast[];
  settle: (id: number, ok: boolean, value?: string) => void;
  dismissToast: (id: number) => void;
}

let seq = 0;

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  toasts: [],
  settle: (id, ok, value) => {
    const item = get().queue.find((q) => q.id === id);
    set({ queue: get().queue.filter((q) => q.id !== id) });
    item?.resolve(ok, value);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

function push(kind: PendingConfirm["kind"], opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = ++seq;
    useDialogStore.setState((s) => ({ queue: [...s.queue, { ...opts, id, kind, resolve }] }));
  });
}

/** Pregunta Sí/No. Resuelve `true` solo si el usuario confirma. */
export function askConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  return push("confirm", typeof opts === "string" ? { message: opts } : opts);
}

/** Aviso con un solo botón. */
export async function showAlert(opts: Omit<ConfirmOptions, "cancelLabel"> | string): Promise<void> {
  await push("alert", typeof opts === "string" ? { message: opts } : opts);
}

/** Pide un texto corto. Resuelve null si se cancela. */
export function askText(opts: ConfirmOptions & { initial?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const id = ++seq;
    useDialogStore.setState((s) => ({
      queue: [...s.queue, { ...opts, id, kind: "prompt", resolve: (ok, value) => resolve(ok ? (value ?? "") : null) }],
    }));
  });
}

/** Aviso breve no bloqueante que se cierra solo. */
export function showToast(message: string, tone: Toast["tone"] = "neutral", ms = 3200): void {
  const id = ++seq;
  useDialogStore.setState((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
  setTimeout(() => useDialogStore.getState().dismissToast(id), ms);
}
