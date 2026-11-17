// EasyUI's Breadcrumb (easyui.site/components/breadcrumb): crumbs with a hover pill that slides between them, and the
// middle folded into "…" when there are many. Changed for Gasho: the colors on Gasho's tokens, the current crumb marked
// anywhere (not only last), several crumbs at one place (a pull request's children), links opened by a function (the
// worktree's tabs) unless a modifier key asks the browser, and Japanese labels.
import { motion } from "framer-motion";
import { ChevronRight, Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";

const spring = { type: "spring", stiffness: 500, damping: 40, mass: 0.6 } as const;

export interface BreadcrumbItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Shown on hover: the whole name when the label is cut. */
  title?: string;
  href?: string;
  /** Opens it in the page; a click with a modifier key follows `href` instead. */
  onOpen?: () => void;
  /** The page the breadcrumb is on. */
  current?: boolean;
}

export interface BreadcrumbProps extends Omit<ComponentProps<"nav">, "children"> {
  /** A place of the trail: one crumb, or several side by side. */
  items: (BreadcrumbItem | BreadcrumbItem[])[];
  label: string;
  /** Collapse the middle into "…" when there are more places than this. */
  maxItems?: number;
}

const LINK =
  "relative flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function Breadcrumb({ items, label, maxItems = 5, className, ...props }: BreadcrumbProps) {
  const uid = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const canCollapse = items.length > maxItems;
  const tail = Math.max(1, maxItems - 2); // places kept at the end while collapsed
  const hiddenFrom = 1;
  const hiddenTo = items.length - tail; // exclusive
  const collapsed = canCollapse && !expanded;

  // move focus to the first revealed crumb
  useEffect(() => {
    if (expanded) listRef.current?.querySelector<HTMLElement>("[data-revealed]")?.focus();
  }, [expanded]);

  const entries: (number | "more")[] = [];
  items.forEach((_, i) => {
    if (collapsed && i >= hiddenFrom && i < hiddenTo) {
      if (i === hiddenFrom) entries.push("more");
    } else entries.push(i);
  });

  const sep = (
    <span aria-hidden className="shrink-0 text-muted-foreground/50 [&>svg]:size-3.5">
      <ChevronRight />
    </span>
  );

  const crumb = (item: BreadcrumbItem, revealed: boolean) => {
    const body = (
      <span className="relative flex min-w-0 items-center gap-1.5 [&>svg]:size-3.5 [&>svg]:shrink-0">
        {item.icon}
        <span className="min-w-0 truncate">{item.label}</span>
      </span>
    );
    if (item.current || !item.href) {
      return (
        <span aria-current={item.current ? "page" : undefined} title={item.title} className={cn(LINK, item.current && "font-medium text-foreground")}>
          {body}
        </span>
      );
    }
    return (
      <a
        href={item.href}
        title={item.title}
        data-revealed={revealed ? "" : undefined}
        onClick={(e: MouseEvent) => {
          if (!item.onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          item.onOpen();
        }}
        onMouseEnter={() => setHover(item.key)}
        onFocus={() => setHover(item.key)}
        onBlur={() => setHover(null)}
        className={cn(LINK, "transition-colors hover:text-foreground")}
      >
        {hover === item.key && <motion.span layoutId={`${uid}-hover`} transition={spring} className="absolute inset-0 rounded-md bg-surface-hover" />}
        {body}
      </a>
    );
  };

  return (
    <nav aria-label={label} className={className} {...props}>
      <ol ref={listRef} onMouseLeave={() => setHover(null)} className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-muted-foreground">
        {entries.map((entry, n) => {
          if (entry === "more") {
            return (
              <motion.li key="more" layout="position" className="flex items-center gap-0.5">
                {sep}
                <button
                  type="button"
                  aria-label="隠した項目を出す"
                  title="隠した項目を出す"
                  onClick={() => setExpanded(true)}
                  className="grid h-7 w-8 cursor-pointer place-items-center rounded-md transition-colors outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Ellipsis className="size-4" />
                </button>
              </motion.li>
            );
          }
          const place = items[entry] as BreadcrumbItem | BreadcrumbItem[];
          const crumbs = Array.isArray(place) ? place : [place];
          const revealed = expanded && canCollapse && entry >= hiddenFrom && entry < hiddenTo;
          return (
            <motion.li
              key={crumbs.map((c) => c.key).join(" ")}
              layout="position"
              initial={revealed ? { opacity: 0, x: -6 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={spring}
              className="flex min-w-0 flex-wrap items-center gap-0.5"
            >
              {n > 0 && sep}
              {crumbs.map((c, i) => (
                <span key={c.key} className="flex min-w-0 items-center gap-0.5">
                  {i > 0 && (
                    <span aria-hidden className="text-muted-foreground/50">
                      ·
                    </span>
                  )}
                  {crumb(c, revealed && entry === hiddenFrom && i === 0)}
                </span>
              ))}
            </motion.li>
          );
        })}
      </ol>
    </nav>
  );
}
