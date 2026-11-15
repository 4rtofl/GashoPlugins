// EasyUI's Skeleton (easyui.site/components/skeleton): placeholder blocks with a slow light sweep, and lines of text.
import { motion } from "framer-motion";
import type { ComponentProps } from "react";
import { cn } from "@gasho/plugin-sdk";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-md bg-neutral-200/70 dark:bg-neutral-800/70", className)} {...props}>
      <motion.span
        className="absolute inset-0 bg-[linear-gradient(90deg,transparent,var(--sk),transparent)] [--sk:rgb(255_255_255/0.65)] dark:[--sk:rgb(255_255_255/0.07)]"
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.2 }}
      />
    </div>
  );
}

const WIDTHS = ["100%", "94%", "98%", "88%"];

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("space-y-2.5", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: i === lines - 1 && lines > 1 ? "62%" : WIDTHS[i % WIDTHS.length] }} />
      ))}
    </div>
  );
}
