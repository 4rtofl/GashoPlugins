// EasyUI's Interactive Timeline (easyui.site/components/interactive-timeline): nodes on a line that fills as it comes
// in, cards that fold and unfold, the one pressed last picked out, and a commit hash that copies. Changed for Gasho:
// the entries are a conversation (a node's icon and tone say what happened), an entry without text is one line
// instead of a card, cards start open, buttons of their own go in the card's header, and the colors on Gasho's tokens.
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Copy, GitCommit, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";
import { motionTransitions } from "./motion.ts";
import { useToast } from "./toast.tsx";

export type TimelineTone = "neutral" | "success" | "danger" | "warning" | "merged";

export interface TimelineEntry {
  key: string;
  icon: LucideIcon;
  tone?: TimelineTone;
  /** Who did what: a card's header, or the whole of a one-line entry. */
  title: ReactNode;
  time?: ReactNode;
  /** A card's text, open at first; without it, the entry is one line. */
  body?: ReactNode;
  /** Buttons in a card's header (pressing them does not fold the card). */
  actions?: ReactNode;
}

const NODE: Record<TimelineTone, string> = {
  neutral: "border-border bg-surface text-muted-foreground",
  success: "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  danger: "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400",
  warning: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  merged: "border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-300",
};

export function Timeline({ entries, label, className }: { entries: TimelineEntry[]; label: string; className?: string }) {
  const id = useId();
  const [picked, setPicked] = useState<string>();
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => {
    setPicked(key);
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  return (
    <div role="region" aria-label={label} className={cn("relative", className)}>
      {/* The line, and its filled part growing in over it. It joins entries, so a single one goes without. */}
      {entries.length > 1 && (
        <>
          <div aria-hidden className="absolute top-4 bottom-4 left-[15px] w-[2px] bg-border" />
          <motion.div
            aria-hidden
            className="absolute top-4 bottom-4 left-[15px] w-[2px] origin-top bg-gradient-to-b from-foreground/30 via-foreground/15 to-transparent"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={motionTransitions.springGentle}
          />
        </>
      )}
      <ol className="relative space-y-3">
        {entries.map((e) => {
          const Icon = e.icon;
          const tone = NODE[e.tone ?? "neutral"];
          if (e.body === undefined) {
            return (
              <li key={e.key} className="flex min-h-8 items-center gap-3 text-xs text-muted-foreground">
                <span className="flex w-8 shrink-0 justify-center">
                  <span className={cn("relative z-10 flex size-6 items-center justify-center rounded-full border", tone)}>
                    <Icon className="size-3.5" />
                  </span>
                </span>
                <span className="min-w-0 flex-1 leading-relaxed break-words">
                  {e.title}
                  {e.time && <span className="ml-1.5 whitespace-nowrap">{e.time}</span>}
                </span>
              </li>
            );
          }
          const open = !folded.has(e.key);
          const panel = `${id}-${e.key}`;
          return (
            <li key={e.key} className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => toggle(e.key)}
                aria-expanded={open}
                aria-controls={panel}
                aria-label={open ? "畳む" : "開く"}
                className={cn("relative z-10 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50", tone)}
              >
                <Icon className="size-4" />
              </button>
              <article className={cn("min-w-0 flex-1 overflow-hidden rounded-xl border transition-colors", picked === e.key ? "border-border-hover bg-surface" : "border-border")}>
                <header onClick={() => toggle(e.key)} className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 bg-surface/60 px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="min-w-0">{e.title}</span>
                  {e.time}
                  <span className="ml-auto flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>
                    {e.actions}
                  </span>
                  <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-muted-foreground">
                    <ChevronDown className="size-3.5" />
                  </motion.span>
                </header>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      id={panel}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={motionTransitions.springGentle}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border px-3 py-2.5">{e.body}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A commit's short hash; pressing it copies the whole one. */
export function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  // The browser may refuse (the page not focused, a permission), and has no clipboard outside https and localhost.
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(hash);
      setCopied(true);
    } catch {
      toast({ title: "ハッシュをコピーできませんでした", description: `ブラウザがクリップボードに書かせませんでした。ハッシュ：${hash}`, tone: "error" });
    }
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="コミットのハッシュをコピーする"
      aria-label={`コミット ${hash.slice(0, 7)} のハッシュをコピーする`}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors outline-none hover:border-border-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <GitCommit className="size-3" />
      {hash.slice(0, 7)}
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
    </button>
  );
}
