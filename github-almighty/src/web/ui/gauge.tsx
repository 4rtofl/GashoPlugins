// The half-ring gauge of EasyUI's Donut Chart (easyui.site/components/donut-chart, variant "semi"): an arc that grows to
// its value over a track, and the value in the middle counting up to it. Changed for Gasho: one value against a
// maximum instead of slices (no legend), a tone for the arc, and a line under the value.
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@gasho/plugin-sdk";
import { EASE_OUT } from "./motion.ts";

const ARC: Record<"success" | "warning", string> = { success: "stroke-emerald-500", warning: "stroke-amber-500" };

const point = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) });
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p0 = point(cx, cy, r, a0);
  const p1 = point(cx, cy, r, a1);
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const fmt = useRef(format);
  fmt.current = format;
  const text = useTransform(mv, (v) => fmt.current(v));
  useEffect(() => {
    const c = animate(mv, value, { duration: reduce ? 0 : 0.8, ease: EASE_OUT });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <motion.span>{text}</motion.span>;
}

export function Gauge({
  value,
  max,
  label,
  caption,
  tone = "success",
  format = (n) => Math.round(n).toLocaleString(),
  size = 176,
  thickness = 12,
  className,
}: {
  value: number;
  max: number;
  label: string;
  caption?: string;
  tone?: "success" | "warning";
  format?: (n: number) => string;
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const r = size / 2 - thickness / 2 - 1;
  const cy = r + thickness / 2 + 1;
  const height = Math.round(r + thickness + 3);
  const start = -Math.PI / 2;
  const pad = thickness / 2 / r;
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const end = useMotionValue(start + pad);
  const d = useTransform(end, (a) => arcPath(size / 2, cy, r, start + pad, Math.max(a, start + pad + 0.0004)));
  useEffect(() => {
    const c = animate(end, start + pad + (Math.PI - 2 * pad) * fraction, reduce ? { duration: 0 } : { duration: 1, ease: EASE_OUT, delay: 0.12 });
    return () => c.stop();
  }, [fraction, end, start, pad, reduce]);
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height }}>
      <svg width={size} height={height} role="img" aria-label={`${label}：${format(value)}${caption ? `（${caption}）` : ""}`} className="block overflow-visible">
        <path d={arcPath(size / 2, cy, r, start + pad, -start - pad)} fill="none" strokeWidth={thickness} strokeLinecap="round" className="stroke-black/[0.05] dark:stroke-white/[0.06]" />
        {fraction > 0 && <motion.path d={d} fill="none" strokeWidth={thickness} strokeLinecap="round" className={ARC[tone]} />}
      </svg>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center text-center">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className="text-2xl leading-tight font-semibold tracking-[-0.03em] text-foreground tabular-nums">
          <AnimatedNumber value={value} format={format} />
        </p>
        {caption && <p className="text-[11px] text-muted-foreground tabular-nums">{caption}</p>}
      </div>
    </div>
  );
}
