// A repository's open issues or pull requests, the latest updated first: { repo, kind, filter?, query?, fresh? } →
// RepoList. `filter`: "all" (the default), "assigned" (to the gh login), "created" (by it), "review" (pull requests whose
// review it was asked for). `query`: words of the title. One GraphQL search (1 point), 50 at most.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { ItemSummary } from "../../types.ts";
import { gh, maxAge } from "../core.ts";
import { kindArg, labelColor, login, num, repoArg, str, summary } from "../gh.ts";
import type { Op } from "../op.ts";

export type ListFilter = "all" | "assigned" | "created" | "review";

export interface ListedItem extends ItemSummary {
  author?: string;
  /** ISO 8601 */
  updatedAt?: string;
  labels: { name: string; color?: string }[];
  comments?: number;
}

export interface RepoList {
  items: ListedItem[];
  /** How many GitHub found: more than `items` when there are over 50. */
  total: number;
}

const FILTERS: Record<ListFilter, string> = { all: "", assigned: "assignee:@me", created: "author:@me", review: "review-requested:@me" };
const FIELDS = "number title state url updatedAt author { login } labels(first: 5) { nodes { name color } } comments { totalCount }";

export function listFilterArg(v: unknown): ListFilter {
  if (v === undefined || v === "") return "all";
  if (typeof v !== "string" || !(v in FILTERS)) throw new PluginError("絞り込みの指定が正しくありません。");
  return v as ListFilter;
}

/** The search goes into a variable of the query, never into the query itself. */
export function listArgs(repo: string, kind: ItemSummary["kind"], filter: ListFilter, words: string): string[] {
  const query =
    "query($q: String!) { search(query: $q, type: ISSUE, first: 50) { issueCount nodes { __typename " +
    `... on Issue { ${FIELDS} } ... on PullRequest { ${FIELDS} isDraft } } } }`;
  const q = [`repo:${repo}`, kind === "pulls" ? "is:pr" : "is:issue", "is:open", "sort:updated-desc", FILTERS[filter], words ? `in:title ${words}` : ""].filter(Boolean).join(" ");
  return ["api", "graphql", "-f", `query=${query}`, "-f", `q=${q}`];
}

/** Only `repo`'s: the words may name other repositories (repo:…). */
export function parseList(json: string, repo: string): RepoList {
  const search = (JSON.parse(json) as { data?: { search?: { issueCount?: unknown; nodes?: unknown[] } | null } }).data?.search;
  const prefix = `https://github.com/${repo}/`.toLowerCase();
  const items = (search?.nodes ?? []).flatMap((n): ListedItem[] => {
    const s = summary(n);
    if (!s || !s.url.toLowerCase().startsWith(prefix)) return [];
    const r = n as Record<string, unknown>;
    const author = login(r.author);
    const updatedAt = str(r.updatedAt);
    const comments = num((r.comments as { totalCount?: unknown } | null)?.totalCount);
    const labels = (((r.labels as { nodes?: unknown[] } | null)?.nodes ?? []) as Record<string, unknown>[]).flatMap((l) => {
      const name = str(l?.name);
      const color = labelColor(l?.color);
      return name ? [{ name, ...(color ? { color } : {}) }] : [];
    });
    return [{ ...s, ...(author ? { author } : {}), ...(updatedAt ? { updatedAt } : {}), labels, ...(comments !== undefined ? { comments } : {}) }];
  });
  return { items, total: num(search?.issueCount) ?? items.length };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const filter = listFilterArg(p.filter);
    const words = typeof p.query === "string" ? p.query.trim() : "";
    if (words.length > 200 || /[\r\n]/.test(words)) throw new PluginError("探す語が正しくありません。");
    return gh("list issues and pull requests", async () => parseList((await ctx.github.read(listArgs(repo, kind, filter, words), { repo, maxAgeSeconds: maxAge(p) })).stdout, repo), ctx);
  },
} satisfies Op;
