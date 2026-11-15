// EasyUI's Button (easyui.site/components/button): a spring tap and a loading spinner. Changed for Gasho: the colors on
// Gasho's tokens, only the variants and sizes github-implement uses, and buttonClass for links that look like buttons.
import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";
import { motionTransitions } from "./motion.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "xs" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-surface text-foreground hover:border-border-hover hover:bg-surface-hover",
  ghost: "border border-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
  destructive: "border border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500 hover:text-white dark:text-red-400 dark:hover:text-white",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-xs [&_svg]:size-3.5",
  xs: "h-7 gap-1 rounded-md px-2 text-xs [&_svg]:size-3.5",
  icon: "size-7 rounded-md [&_svg]:size-3.5",
};

const BASE =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** The classes of a Button, for an <a> that looks like one. */
export const buttonClass = (variant: ButtonVariant = "secondary", size: ButtonSize = "sm"): string => cn(BASE, VARIANTS[variant], SIZES[size]);

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner in place of the left icon and disables the button. */
  isLoading?: boolean;
  /** Shown instead of the children while loading. */
  loadingText?: string;
  leftIcon?: ReactNode;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", isLoading = false, loadingText, leftIcon, disabled, className, children, type = "button", ...props },
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
      className={cn(buttonClass(variant, size), off && "pointer-events-none opacity-40", className)}
      {...props}
    >
      {isLoading ? <Loader2 className="shrink-0 animate-spin" /> : leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
      {isLoading && loadingText ? <span>{loadingText}</span> : children}
    </motion.button>
  );
});
