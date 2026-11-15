// What one issue's or pull request's screen is made of, each part a file of its folder: the tabs (tabs/), the rows
// between the title and the tabs (sections/), and what the conversation shows (conversation/). The screen takes every
// file of those folders (Vite's import.meta.glob), so that a new part is a new file and changes no file that is there.
// A part reads the item and runs changes with useItem (context.tsx).
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { GitHubItemDetail, GitHubKind } from "../../types.ts";
import type { TimelineEntry } from "../ui/timeline.tsx";

/** A tab of the screen: a file of tabs/. */
export interface ItemTab {
  id: string;
  label: string;
  /** Smaller first. */
  order: number;
  /** The kinds that have it: an issue has only the conversation. */
  kinds: GitHubKind[];
  icon?: LucideIcon;
  /** A count beside the label. */
  badge?: (item: GitHubItemDetail) => string | number | undefined;
  View: ComponentType;
}

/** A row between the title and the tabs: a file of sections/. */
export interface ItemSection {
  /** Smaller higher. */
  order: number;
  kinds: GitHubKind[];
  View: ComponentType;
}

/** An entry of the conversation's timeline, and when it happened. */
export interface ConversationEntry extends TimelineEntry {
  /** ISO 8601: the entries are shown newest first. */
  at: string;
  /** Shown here whatever `at` says: "top" above the parts under the body (the body), "bottom" below every entry. */
  pin?: "top" | "bottom";
}

/** What the conversation shows: a file of conversation/. */
export interface ConversationPart {
  /** Among entries of the same moment, and among the parts under the body: smaller first. */
  order: number;
  /** A React hook: the part's entries (it may read more with useRequest). */
  useEntries?: () => ConversationEntry[];
  /** Under the body, above the other entries, such as the box for a new comment. */
  UnderBody?: ComponentType;
}

/** The default exports of a folder's files, smaller `order` first. */
export function partsOf<T extends { order: number }>(modules: Record<string, { default: T }>): T[] {
  return Object.values(modules)
    .map((m) => m.default)
    .sort((a, b) => a.order - b.order);
}
