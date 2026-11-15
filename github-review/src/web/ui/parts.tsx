// The parts github-review takes from Gasho's screen (as the kanban does), which the SDK does not provide: EasyUI's
// Button, Alert, Badge, Skeleton and DrawCheckbox with their colors on Gasho's tokens.
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { CircleAlert, Info, Loader2, TriangleAlert, type LucideIcon } from "lucide-react";
import { forwardRef, useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";
import { motionTransitions } from "./styles";

// ---- Button (easyui.site/components/button): a spring tap and a loading spinner ----

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** Shows a spinner in place of the left icon and disables the button. */
  isLoading?: boolean;
  /** Shown instead of the children while loading. */
  loadingText?: string;
  leftIcon?: ReactNode;
  children?: ReactNode;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-surface text-foreground hover:border-border-hover hover:bg-surface-hover",
  ghost: "border border-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
};

const BUTTON_SIZES = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-xs [&_svg]:size-3.5",
  md: "h-10 gap-2 rounded-lg px-4 text-sm [&_svg]:size-4",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", isLoading = false, loadingText, leftIcon, disabled, className, children, type = "button", ...props },
  ref,
) {
  const off = disabled || isLoading;
  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={off}
      whileTap={off ? undefined : { scale: 0.97 }}
      transition={motionTransitions.springSnappy}
      aria-busy={isLoading}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        off && "pointer-events-none opacity-40",
        className,
      )}
      {...props}
    >
      {isLoading ? <Loader2 className="shrink-0 animate-spin" /> : leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
      {isLoading && loadingText ? <span>{loadingText}</span> : children && <span>{children}</span>}
    </motion.button>
  );
});

// ---- Alert (easyui.site/components/alert): a message with a tone-aware icon ----

export type AlertTone = "neutral" | "warning" | "danger";

const ALERT_TONES: Record<AlertTone, { box: string; icon: string; Icon: LucideIcon }> = {
  neutral: { box: "border-neutral-200 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-900/60", icon: "text-neutral-500 dark:text-neutral-400", Icon: Info },
  warning: { box: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/[0.08]", icon: "text-amber-600 dark:text-amber-400", Icon: TriangleAlert },
  danger: { box: "border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/[0.08]", icon: "text-red-600 dark:text-red-400", Icon: CircleAlert },
};

export function Alert({ tone = "neutral", className, children, ...props }: ComponentProps<"div"> & { tone?: AlertTone }) {
  const t = ALERT_TONES[tone];
  return (
    <div role={tone === "neutral" ? "status" : "alert"} className={cn("flex items-start gap-3 rounded-xl border p-3.5 text-sm", t.box, className)} {...props}>
      <t.Icon className={cn("mt-0.5 size-4 shrink-0", t.icon)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("font-medium text-neutral-900 dark:text-neutral-100", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-0.5 text-neutral-600 dark:text-neutral-400", className)} {...props} />;
}

// ---- Badge: a pill with an optional status dot; a count or a short text rolls when it changes ----

export type BadgeTone = "neutral" | "success" | "warning" | "danger";

const BADGE_STYLES: Record<"soft" | "outline", Record<BadgeTone, string>> = {
  soft: {
    neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
    danger: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  },
  outline: {
    neutral: "border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300",
    success: "border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400",
    warning: "border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-400",
    danger: "border-red-200 text-red-700 dark:border-red-500/30 dark:text-red-400",
  },
};

const BADGE_DOTS: Record<BadgeTone, string> = { neutral: "bg-neutral-400", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500" };
const ROLL = { type: "spring", stiffness: 520, damping: 36, mass: 0.6 } as const;

export function Badge({
  variant = "soft",
  tone = "neutral",
  dot,
  className,
  children,
  ...props
}: Omit<HTMLMotionProps<"span">, "children"> & { variant?: "soft" | "outline"; tone?: BadgeTone; dot?: boolean; children?: ReactNode }) {
  const roll = typeof children === "string" || typeof children === "number";
  return (
    <motion.span
      className={cn(
        "relative inline-flex h-6 items-center gap-1.5 rounded-full border border-transparent px-2.5 font-sans text-xs font-medium whitespace-nowrap",
        BADGE_STYLES[variant][tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("relative size-1.5 shrink-0 rounded-full", BADGE_DOTS[tone])} />}
      {roll ? (
        <span className="relative inline-flex overflow-hidden py-px">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={String(children)}
              initial={{ y: "70%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-70%", opacity: 0 }}
              transition={ROLL}
              className="inline-block tabular-nums"
            >
              {children}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : (
        children
      )}
    </motion.span>
  );
}

// ---- Skeleton (easyui.site/components/skeleton): a placeholder with a slow light sweep ----

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-md bg-neutral-200/70 dark:bg-neutral-800/70", className)} {...props}>
      <motion.div
        className="absolute inset-0 bg-[linear-gradient(90deg,transparent,var(--sk),transparent)] [--sk:rgb(255_255_255/0.65)] dark:[--sk:rgb(255_255_255/0.07)]"
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
      />
    </div>
  );
}

// ---- DrawCheckbox (easyui.site/components/draw-checkbox): the check draws itself ----

const SETTLE = [0.16, 1, 0.3, 1] as const;

export function DrawCheckbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5 select-none", disabled && "cursor-not-allowed opacity-40", className)}>
      <span className="relative mt-0.5 flex">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 m-0 size-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <motion.span
          aria-hidden
          initial={false}
          animate={{ scale: checked ? [0.9, 1.04, 1] : 1 }}
          transition={{ duration: 0.32, ease: SETTLE }}
          className={cn(
            "pointer-events-none flex size-4 items-center justify-center rounded-[4px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50",
            checked ? "border-primary bg-primary text-primary-foreground" : "border-border-hover bg-surface-raised",
          )}
        >
          {checked && (
            <motion.svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <motion.path d="M3.5 8.5 L6.5 11.5 L12.5 5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.28, ease: [0.65, 0, 0.35, 1] }} />
            </motion.svg>
          )}
        </motion.span>
      </span>
      {(label || description) && (
        <label htmlFor={id} className={cn("min-w-0 cursor-pointer text-left", disabled && "cursor-not-allowed")}>
          {label && <span className="block text-sm leading-tight text-foreground">{label}</span>}
          {description && <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>}
        </label>
      )}
    </div>
  );
}
