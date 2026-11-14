// EasyUI's Badge (easyui.site/components/badge): a pill whose number or short text rolls when it changes, with a status
// dot and an × for a chip. Changed for Gasho: a violet tone for what GitHub shows in purple (merged, closed as done), a
// dot of any color (a label's), a leading icon, and Japanese labels.
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "merged";

const STYLES: Record<"soft" | "outline", Record<BadgeTone, string>> = {
  soft: {
    neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
    danger: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
    merged: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  },
  outline: {
    neutral: "border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300",
    success: "border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400",
    warning: "border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-400",
    danger: "border-red-200 text-red-700 dark:border-red-500/30 dark:text-red-400",
    merged: "border-violet-200 text-violet-700 dark:border-violet-500/30 dark:text-violet-300",
  },
};

const DOTS: Record<BadgeTone, string> = { neutral: "bg-neutral-400", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500", merged: "bg-violet-500" };
const ROLL = { type: "spring", stiffness: 520, damping: 36, mass: 0.6 } as const;

export type BadgeProps = Omit<HTMLMotionProps<"span">, "children"> & {
  variant?: "soft" | "outline";
  tone?: BadgeTone;
  /** A leading dot in the tone's color, or in this color (#rrggbb). */
  dot?: boolean | string;
  icon?: ReactNode;
  /** Shows an × that calls it (a chip). */
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
  children?: ReactNode;
};

export function Badge({ variant = "soft", tone = "neutral", dot, icon, onRemove, removeLabel = "外す", removeDisabled, className, children, ...props }: BadgeProps) {
  const roll = typeof children === "string" || typeof children === "number";
  return (
    <motion.span
      className={cn(
        "relative inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-transparent px-2.5 font-sans text-xs font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
        STYLES[variant][tone],
        onRemove && "pr-1",
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", typeof dot === "string" ? undefined : DOTS[tone])}
          style={typeof dot === "string" ? { backgroundColor: dot } : undefined}
        />
      )}
      {icon}
      {roll ? (
        <span className="relative inline-flex min-w-0 overflow-hidden py-px">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={String(children)}
              initial={{ y: "70%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-70%", opacity: 0 }}
              transition={ROLL}
              className="inline-block truncate tabular-nums"
            >
              {children}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : (
        children
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          disabled={removeDisabled}
          onClick={onRemove}
          className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full opacity-60 outline-none transition hover:bg-black/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/15"
        >
          <X className="size-3" />
        </button>
      )}
    </motion.span>
  );
}
