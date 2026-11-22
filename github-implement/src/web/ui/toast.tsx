// EasyUI's VelocityToast and Undo Toast (easyui.site/components/velocity-toast, …/undo-toast): a toast that enters
// with velocity and settles, with a bar that runs down and pauses while the pointer is on it; the Undo Toast also
// offers to put the change back. Changed for Gasho: one toast at a time from a provider (a new one takes the place of
// the last), the colors on Gasho's tokens, an undo that waits for the daemon part and says whether it worked, longer
// for an error and with its whole text, a key that moves the focus to it (KEY) and back, and Japanese labels.
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { AlertCircle, Check, Info, Loader2, Undo2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";
import { motionTransitions } from "./motion.ts";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Puts the change back; resolves to an error message when it could not. Makes it an Undo Toast. */
  undo?: () => Promise<string | undefined>;
}

interface Shown extends ToastInput {
  key: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => undefined);

/**
 * Moves the focus to the toast's buttons, as the toast is drawn after the page. It types nothing in a text box (⌥T
 * types "†" on a Mac) and is none of Gasho's keys or the plugins' (⌘K, ⌘B, ⌘S, ⌘Enter, ⌥↑↓); Radix's toasts use it too.
 */
const KEY = "F8";

/** Shows a toast at the bottom of the page, in place of the one there. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Shown>();
  const count = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  // Where the focus was before KEY: it goes back there when the toast closes.
  const back = useRef<HTMLElement | null>(null);
  const show = useCallback((t: ToastInput) => setToast({ ...t, key: ++count.current }), []);
  // The focus goes back while the toast still has it.
  const leave = useCallback(() => {
    if (box.current?.contains(document.activeElement)) back.current?.focus();
    back.current = null;
  }, []);
  const done = useCallback(
    (key: number) => {
      leave();
      setToast((t) => (t?.key === key ? undefined : t));
    },
    [leave],
  );
  useEffect(() => {
    if (!toast) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== KEY || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const first = box.current?.querySelector<HTMLButtonElement>("button");
      if (!first) return;
      e.preventDefault();
      if (!box.current?.contains(document.activeElement)) back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      first.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div ref={box} className="pointer-events-none fixed bottom-5 left-1/2 z-[95] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center">
        <AnimatePresence>{toast && <ToastCard key={toast.key} toast={toast} onDone={done} onLeave={leave} onFailed={show} />}</AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/** The bar's width: from 100% to 0 over `duration` while it runs, a little faster at the end so that closing looks meant. */
function useCountdown(duration: number, running: boolean, onEnd: () => void) {
  const progress = useMotionValue(100);
  const left = useRef(duration);
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const from = left.current;
    let frame = 0;
    const tick = () => {
      const remaining = Math.max(0, from - (performance.now() - start));
      left.current = remaining;
      progress.set(Math.pow(remaining / duration, 1.05) * 100);
      if (remaining <= 0) end.current();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, duration, progress]);
  return useTransform(progress, (v) => `${v}%`);
}

const ICON: Record<ToastTone, ReactNode> = {
  success: <Check className="size-4 text-emerald-500 dark:text-emerald-400" />,
  error: <AlertCircle className="size-4 text-red-500 dark:text-red-400" />,
  info: <Info className="size-4 text-muted-foreground" />,
};

function ToastCard({ toast, onDone, onLeave, onFailed }: { toast: Shown; onDone: (key: number) => void; onLeave: () => void; onFailed: (t: ToastInput) => void }) {
  const tone = toast.tone ?? "success";
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<"shown" | "undoing" | "restored">("shown");
  const { key } = toast;
  const close = () => onDone(key);
  const width = useCountdown(tone === "error" ? 9000 : toast.undo ? 6500 : 4000, !paused && phase === "shown", close);

  // onDone and key stay the same while the toast shows: the page drawn again does not start the wait over.
  useEffect(() => {
    if (phase !== "restored") return;
    const t = setTimeout(() => onDone(key), 1400);
    return () => clearTimeout(t);
  }, [phase, onDone, key]);

  const undo = async () => {
    if (!toast.undo || phase !== "shown") return;
    // The button goes away with the focus on it, after Enter.
    onLeave();
    setPhase("undoing");
    const error = await toast.undo();
    if (error) onFailed({ title: "元に戻せませんでした", description: error, tone: "error" });
    else setPhase("restored");
  };

  return (
    <motion.div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      initial={{ opacity: 0, y: 22, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={motionTransitions.springSnappy}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
      }}
      aria-keyshortcuts={KEY}
      className="pointer-events-auto relative w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-3.5 text-foreground shadow-xl select-none"
    >
      <div className="relative flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised">
          {phase === "restored" ? (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={motionTransitions.springSnappy}>
              <Check className="size-4 text-emerald-500 dark:text-emerald-400" />
            </motion.span>
          ) : phase === "undoing" ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            ICON[tone]
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-semibold", tone !== "error" && "truncate")}>{phase === "restored" ? "元に戻しました" : phase === "undoing" ? "元に戻しています…" : toast.title}</p>
          {toast.description && phase === "shown" && (
            <p className={cn("mt-0.5 text-[11px] text-muted-foreground", tone === "error" ? "break-words whitespace-pre-line select-text" : "truncate")}>{toast.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Not on a phone's width, which has no keys. */}
          <kbd title={`${KEY} でこの通知のボタンへ移る（Esc で閉じる）`} className="hidden rounded border border-border px-1 font-mono text-[10px] text-muted-foreground sm:inline">
            {KEY}
          </kbd>
          {toast.undo && phase === "shown" && (
            <button
              type="button"
              onClick={() => void undo()}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium transition-colors outline-none hover:border-border-hover focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Undo2 className="size-3 text-muted-foreground" />
              元に戻す
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors outline-none hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {phase === "shown" && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-border">
          <motion.div className={cn("h-full", tone === "error" ? "bg-red-500" : "bg-foreground")} style={{ width }} />
        </div>
      )}
    </motion.div>
  );
}
