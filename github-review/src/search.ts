// The search words of the review page, as GitHub's search reads them, and what github-review does with them. The upper
// part of the page lists only open pull requests. GitHub takes repo:, org: and user: as "any of" (with the watched
// repositories' repo:, the words would find other repositories' pull requests instead of narrowing them), so those
// words narrow the watched repositories instead of going to GitHub with them.

/** The words split as GitHub's search splits them: on spaces, but not inside double quotes (label:"good first issue"). */
export function splitWords(words: string): string[] {
  return words.match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [];
}

interface Qualifier {
  not: boolean;
  key: string;
  /** In lower case, without its quotes. */
  value: string;
}

function qualifier(token: string): Qualifier | undefined {
  const m = /^(-?)([A-Za-z-]+):(.+)$/.exec(token);
  return m ? { not: m[1] === "-", key: (m[2] ?? "").toLowerCase(), value: (m[3] ?? "").replace(/^"|"$/g, "").toLowerCase() } : undefined;
}

const isState = (q: Qualifier | undefined): q is Qualifier =>
  Boolean(q && ((q.key === "is" && ["open", "closed", "merged", "unmerged"].includes(q.value)) || (q.key === "state" && ["open", "closed", "merged"].includes(q.value))));

/** Whether a word about the state lets an open pull request through. */
const letsOpen = (q: Qualifier): boolean => (q.not ? q.value !== "open" && q.value !== "unmerged" : q.value === "open" || q.value === "unmerged");

/**
 * The words for open pull requests only: without those about the state (is:open, is:merged, state:closed…), to go
 * after is:open. Undefined when they find no open one (is:merged, -is:open…).
 */
export function openWords(words: string): string | undefined {
  const tokens = splitWords(words);
  const states = tokens.map(qualifier).filter(isState);
  if (!states.every(letsOpen)) return undefined;
  return tokens.filter((t) => !isState(qualifier(t))).join(" ");
}

const NAMES_REPOS = new Set(["repo", "org", "user"]);

/**
 * The words without the repo:, org: and user: that name repositories, and, when there were some, which repositories
 * they name (GitHub's "any of"). A -repo: stays in the words: GitHub leaves that repository out.
 */
export function repoWords(words: string): { words: string; names?: (repo: string) => boolean } {
  const tokens = splitWords(words);
  const named = tokens.map(qualifier).filter((q): q is Qualifier => Boolean(q && !q.not && NAMES_REPOS.has(q.key)));
  if (named.length === 0) return { words: tokens.join(" ") };
  const rest = tokens.filter((t) => {
    const q = qualifier(t);
    return !(q && !q.not && NAMES_REPOS.has(q.key));
  });
  const names = (repo: string): boolean => {
    const r = repo.toLowerCase();
    const owner = r.split("/")[0];
    return named.some((q) => (q.key === "repo" ? q.value === r : q.value === owner));
  };
  return { words: rest.join(" "), names };
}

/** The order GitHub lists in, when the page can put lists from several searches in it too (by the time it gives). */
export interface Order {
  key: "createdAt" | "updatedAt";
  desc: boolean;
}

/** The order of `words` (the newest first without a sort:); undefined for one the page cannot follow (reactions…). */
export function orderOf(words: string): Order | undefined {
  const sort = splitWords(words)
    .map(qualifier)
    .find((q) => q && !q.not && q.key === "sort");
  if (!sort) return { key: "createdAt", desc: true };
  const m = /^(created|updated)(?:-(asc|desc))?$/.exec(sort.value);
  return m ? { key: m[1] === "updated" ? "updatedAt" : "createdAt", desc: m[2] !== "asc" } : undefined;
}

/**
 * Pull requests of several searches in the order of `words`; those from the same search keep their order, as do all
 * of them in an order the page cannot follow.
 */
export function inOrder<T extends { createdAt?: string; updatedAt?: string }>(prs: T[], words: string): T[] {
  const order = orderOf(words);
  if (!order) return prs;
  const at = (p: T): number => {
    const t = Date.parse(p[order.key] ?? "");
    return Number.isNaN(t) ? 0 : t;
  };
  return prs
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (order.desc ? at(b.p) - at(a.p) : at(a.p) - at(b.p)) || a.i - b.i)
    .map((x) => x.p);
}
