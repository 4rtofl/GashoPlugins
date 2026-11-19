// EasyUI's Animated Tabs (easyui.site/components/animated-tabs): a pill that slides to the tab chosen, and the content
// cross-fading. Changed for Gasho: the roles and keys of a tab list (arrows, Home and End), a count that rolls (Badge)
// beside a label, and the colors on Gasho's tokens.
import { AnimatePresence, motion } from "framer-motion";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";
import { motionTransitions } from "./motion.ts";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
}

/** The tabs, and below them the content of the one chosen (`children`). */
export function AnimatedTabs({ tabs, value, onChange, label, children }: { tabs: TabItem[]; value: string; onChange: (id: string) => void; label: string; children: ReactNode }) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent, at: number) => {
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div ref={list} role="tablist" aria-label={label} className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 select-none dark:border-neutral-800 dark:bg-neutral-950">
          {tabs.map((tab, i) => {
            const active = tab.id === value;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${id}-tab-${tab.id}`}
                data-tab={tab.id}
                aria-selected={active}
                aria-controls={`${id}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => onChange(tab.id)}
                onKeyDown={(e) => move(e, i)}
                className={cn(
                  "relative flex cursor-pointer items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-sm",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${id}-pill`}
                    transition={motionTransitions.springMorph}
                    className="absolute inset-0 rounded-md border border-border-hover bg-surface shadow-xs dark:border-neutral-800 dark:bg-neutral-900"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5 [&_svg]:size-3.5">
                  {tab.icon}
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span className="rounded border border-border bg-surface-hover px-1.5 py-px font-mono text-[10px] text-muted-foreground tabular-nums dark:border-neutral-800 dark:bg-neutral-900">
                      {tab.badge}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`} className="relative min-h-[60px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={motionTransitions.springGentle}>
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
