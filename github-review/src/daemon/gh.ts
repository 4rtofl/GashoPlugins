// GitHub for github-review: one GraphQL query (gh api graphql, about 3 points of the hourly 5000) reads the page of a
// working server: the open pull requests I am asked to review, those I opened in the watched repositories, those of the watched repositories, and those that have
// a review worktree, each with the marks of the latest comments (verdict.ts). The search words go into variables of the query, never into the query itself; GitHub's search
// takes them as its list of pull requests does (author:, label:, …). Everything here only builds arguments and reads
// output, so that it can be tested without gh.
import { mergeOrdered } from "../items.ts";
import { openWords, splitWords } from "../search.ts";
import { SEARCH_LIMIT, type CheckRunState, type CheckState, type PrCheck, type PrComment, type PrDetail, type PrRow, type PrState, type ReviewState } from "../types.ts";
import { latestMark } from "../verdict.ts";

export { SEARCH_LIMIT };
/** The latest comments read of each pull request for the mark of its review: few, to keep the query cheap. */
export const MARK_COMMENTS = 10;
/** The latest reviews that request changes read of each pull request, for when "差し戻す" is done (cleanup.ts). */
export const CHANGES_REVIEWS = 5;
/** GitHub's search takes a query of up to 256 characters: the watched repositories go into as many searches as need be. */
const QUERY_MAX = 256;

const PR_FIELDS =
  "number title url state isDraft createdAt updatedAt headRefName headRefOid isCrossRepository headRepositoryOwner { login } repository { nameWithOwner } author { login } " +
  "labels(first: 10) { nodes { name color } } reviewDecision totalCommentsCount statusCheckRollup { state } " +
  `viewerDidAuthor mergeable maintainerCanModify recent: comments(last: ${MARK_COMMENTS}) { nodes { viewerDidAuthor body url createdAt } } ` +
  `changes: reviews(last: ${CHANGES_REVIEWS}, states: [CHANGES_REQUESTED]) { nodes { viewerDidAuthor submittedAt } }`;
/** The upper part's searches also read what GitHub can sort by, to put their answers in one order. */
const UPPER_NODES = `nodes { ... on PullRequest { ${PR_FIELDS} reactions { totalCount } reactionGroups { content reactors { totalCount } } } }`;

/** GitHub sorts a search by best match: the list of pull requests puts the newest first. */
const sorted = (words: string): string => (/(^|\s)sort:/.test(words) ? words : `${words} sort:created-desc`.trim());

/**
 * The search of the open pull requests I am asked to review, in all of GitHub; undefined when the words find no open
 * one (is:merged…).
 */
export function requestedQuery(words: string): string | undefined {
  const open = openWords(words);
  return open === undefined ? undefined : sorted(`is:pr is:open review-requested:@me archived:false ${open}`.trim());
}

/**
 * The search words about who opened a pull request, apart from the others. GitHub takes `author:` only in lower case,
 * its value in any case and with or without quotes.
 */
export function authorWords(words: string): { rest: string; only: string[]; not: string[] } {
  const rest: string[] = [];
  const only: string[] = [];
  const not: string[] = [];
  for (const word of splitWords(words)) {
    const m = /^(-?)author:(.+)$/.exec(word);
    if (m) (m[1] ? not : only).push((m[2] ?? "").replaceAll('"', "").toLowerCase());
    else rest.push(word);
  }
  return { rest: rest.join(" "), only, not };
}

/**
 * The search words that say where to search, apart from the others. GitHub takes any of them as one more place to look
 * (`repo:a org:b` finds those of both), and only in lower case; `-repo:` and the like only ever narrow, and stay.
 */
export function scopeWords(words: string): { rest: string; repos: string[]; owners: string[] } {
  const rest: string[] = [];
  const repos: string[] = [];
  const owners: string[] = [];
  for (const word of splitWords(words)) {
    const m = /^(repo|org|user|owner):(.+)$/.exec(word);
    if (m) (m[1] === "repo" ? repos : owners).push((m[2] ?? "").replaceAll('"', "").toLowerCase());
    else rest.push(word);
  }
  return { rest: rest.join(" "), repos, owners };
}

/** Whether the words about where to search (scopeWords) leave `repo`: any one does when they say nothing about it. */
export function inScope(scope: { repos: string[]; owners: string[] }, repo: string): boolean {
  if (scope.repos.length === 0 && scope.owners.length === 0) return true;
  const name = repo.toLowerCase();
  return scope.repos.includes(name) || scope.owners.includes(name.split("/")[0] ?? "");
}

/** The searches of the upper part, and the repositories those of mine look in. */
export interface UpperSearches {
  /** Undefined: the words find no open pull request, so the upper part is not read. */
  requested: string | undefined;
  own: string[];
  both: string[];
  repos: string[];
}

/**
 * The upper part's searches: those I am asked to review (in all of GitHub), those I opened in the watched repositories,
 * and how many are both. GitHub widens `author:@me author:octocat` to either one and lets `-author:@me` undo `author:@me`,
 * so the words about the author stay out of the searches of mine: ownWanted decides from them whether mine are shown at
 * all. The words about where to search stay out too, or GitHub would look beyond the watched repositories: they choose
 * among those. The repositories of each search are others', so that nothing is found twice. Like those I am asked to
 * review, mine are only the open ones.
 */
export function upperSearches(words: string, watched: readonly string[]): UpperSearches {
  const scope = scopeWords(authorWords(words).rest);
  const open = openWords(scope.rest);
  const repos = open === undefined ? [] : watched.filter((r) => inScope(scope, r));
  return {
    requested: requestedQuery(words),
    own: repoSearches(repos, (rs) => sorted(`is:pr is:open author:@me archived:false ${rs} ${open ?? ""}`.trim())),
    both: repoSearches(repos, (rs) => `is:pr is:open author:@me review-requested:@me archived:false ${rs} ${open ?? ""}`.trim()),
    repos,
  };
}

/** Whether the search words leave the pull requests opened by `login` (me) in the list. */
export function ownWanted(words: string, login: string | undefined): boolean {
  const { only, not } = authorWords(words);
  const me = (author: string) => author === "@me" || author === login?.toLowerCase();
  return !not.some(me) && (only.length === 0 || only.some(me));
}

/** The searches `query` makes of the repositories (as `repo:` words): as few as fit GitHub's limit on a query. */
function repoSearches(repos: readonly string[], query: (repoWords: string) => string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const of = (rs: string[]) => query(rs.map((r) => `repo:${r}`).join(" "));
  for (const r of repos) {
    if (cur.length > 0 && of([...cur, r]).length > QUERY_MAX) {
      out.push(of(cur));
      cur = [];
    }
    cur.push(r);
  }
  if (cur.length > 0) out.push(of(cur));
  return out;
}

/** The searches of the watched repositories' pull requests. */
export function watchedQueries(repos: readonly string[], words: string): string[] {
  return repoSearches(repos, (rs) => sorted(`is:pr ${rs} ${words}`.trim()));
}

/** The pull requests read by number: those with a review worktree. */
export interface Lookup {
  repo: string;
  numbers: number[];
}

/** The search of how many pull requests one repository has for `words` (which name no repository). */
export const countQuery = (repo: string, words: string): string => `is:pr repo:${repo} ${words}`.trim();

/** What the page's query asks: the upper part's searches (upperSearches), and those of the lower part. */
export interface ListAsk extends Pick<UpperSearches, "requested" | "own" | "both"> {
  watched: string[];
  /** How many each watched repository has, when the watched searches hold several (a search counts them all at once). */
  counts: string[];
  /** The searches of the open pull requests with a review worktree in repositories that are not watched (their URLs only). */
  kept: string[];
  lookups: Lookup[];
}

/** The gh arguments of the page's query. */
export function listArgs(p: ListAsk): string[] {
  const decls: string[] = [];
  const fields: string[] = ["viewer { login }"];
  const vars: string[] = [];
  const search = (alias: string, q: string, first: number, nodes: string) => {
    decls.push(`$${alias}: String!`);
    fields.push(`${alias}: search(query: $${alias}, type: ISSUE, first: ${first}) { issueCount${nodes ? ` ${nodes}` : ""} }`);
    vars.push("-f", `${alias}=${q}`);
  };
  const full = `nodes { ... on PullRequest { ${PR_FIELDS} } }`;
  if (p.requested !== undefined) search("req", p.requested, SEARCH_LIMIT, UPPER_NODES);
  p.own.forEach((q, i) => search(`own${i}`, q, SEARCH_LIMIT, UPPER_NODES));
  // Only the number: first 0 reads no pull request, and costs next to nothing.
  p.both.forEach((q, i) => search(`both${i}`, q, 0, ""));
  p.watched.forEach((q, i) => search(`w${i}`, q, SEARCH_LIMIT, full));
  p.counts.forEach((q, i) => search(`c${i}`, q, 0, ""));
  p.kept.forEach((q, i) => search(`k${i}`, q, SEARCH_LIMIT, "nodes { ... on PullRequest { url } }"));
  p.lookups.forEach((l, i) => {
    const [owner, name] = l.repo.split("/") as [string, string];
    decls.push(`$o${i}: String!`, `$n${i}: String!`);
    // The numbers go into the query itself (aliases p<number>), which only ever holds digits.
    const prs = [...new Set(l.numbers)].map((n) => `p${n}: pullRequest(number: ${Math.trunc(n)}) { ${PR_FIELDS} }`);
    fields.push(`l${i}: repository(owner: $o${i}, name: $n${i}) { ${prs.join(" ")} }`);
    vars.push("-f", `o${i}=${owner}`, "-f", `n${i}=${name}`);
  });
  return ["api", "graphql", "-f", `query=query(${decls.join(", ")}) { ${fields.join(" ")} }`, ...vars];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const STATES: Record<string, PrState> = { OPEN: "open", CLOSED: "closed", MERGED: "merged" };
const CHECKS: Record<string, CheckState> = { SUCCESS: "success", FAILURE: "failure", ERROR: "failure", PENDING: "pending", EXPECTED: "pending" };
const REVIEWS: Record<string, ReviewState> = { APPROVED: "approved", CHANGES_REQUESTED: "changes_requested", REVIEW_REQUIRED: "review_required" };

/** Comments as GitHub gives them (nodes of a connection), oldest first. */
function parseComments(conn: unknown): PrComment[] {
  const nodes = isRecord(conn) && Array.isArray(conn.nodes) ? conn.nodes : [];
  return nodes.flatMap((n): PrComment[] => {
    if (!isRecord(n) || typeof n.body !== "string" || !str(n.url)) return [];
    const author = str((n.author as { login?: unknown } | null)?.login);
    return [{ ...(author ? { author } : {}), body: n.body, ...(str(n.createdAt) ? { at: str(n.createdAt) } : {}), url: str(n.url) ?? "", mine: n.viewerDidAuthor === true }];
  });
}

/** When I last requested changes, of the reviews that request changes (nodes of a connection). */
function myChanges(conn: unknown): string | undefined {
  const nodes = isRecord(conn) && Array.isArray(conn.nodes) ? conn.nodes : [];
  let latest: string | undefined;
  for (const n of nodes) {
    const at = isRecord(n) && n.viewerDidAuthor === true ? str(n.submittedAt) : undefined;
    if (at && !Number.isNaN(Date.parse(at)) && (!latest || Date.parse(at) > Date.parse(latest))) latest = at;
  }
  return latest;
}

/** A pull request as the query reads it; undefined for anything else (an issue, a missing one). */
export function parsePr(raw: unknown): PrRow | undefined {
  if (!isRecord(raw)) return undefined;
  const repo = str((raw.repository as { nameWithOwner?: unknown } | null)?.nameWithOwner);
  const url = str(raw.url);
  const state = STATES[str(raw.state) ?? ""];
  if (typeof raw.number !== "number" || typeof raw.title !== "string" || !repo || !url?.startsWith("https://github.com/") || !state || typeof raw.headRefName !== "string") {
    return undefined;
  }
  const labels = (Array.isArray((raw.labels as { nodes?: unknown } | null)?.nodes) ? ((raw.labels as { nodes: unknown[] }).nodes as unknown[]) : []).flatMap((l) => {
    const name = str((l as { name?: unknown } | null)?.name);
    const color = str((l as { color?: unknown } | null)?.color);
    return name ? [{ name, ...(color && /^[0-9a-f]{6}$/i.test(color) ? { color } : {}) }] : [];
  });
  const checks = CHECKS[str((raw.statusCheckRollup as { state?: unknown } | null)?.state) ?? ""];
  const review = REVIEWS[str(raw.reviewDecision) ?? ""];
  const author = str((raw.author as { login?: unknown } | null)?.login);
  const head = str(raw.headRefOid);
  const headOwner = raw.isCrossRepository === true ? str((raw.headRepositoryOwner as { login?: unknown } | null)?.login) : undefined;
  const mark = latestMark(parseComments(raw.recent));
  const changesRequestedAt = myChanges(raw.changes);
  return {
    repo,
    number: raw.number,
    title: raw.title,
    url,
    state,
    ...(raw.isDraft === true ? { draft: true } : {}),
    ...(author ? { author } : {}),
    ...(typeof raw.createdAt === "string" ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
    labels,
    ...(checks ? { checks } : {}),
    ...(review ? { review } : {}),
    comments: typeof raw.totalCommentsCount === "number" ? raw.totalCommentsCount : 0,
    branch: raw.headRefName,
    ...(raw.isCrossRepository === true ? { fork: true } : {}),
    ...(headOwner ? { headOwner } : {}),
    ...(head ? { head: head.toLowerCase() } : {}),
    ...(raw.viewerDidAuthor === true ? { own: true } : {}),
    ...(raw.mergeable === "CONFLICTING" ? { conflict: true } : {}),
    ...(raw.maintainerCanModify === true ? { canModify: true } : {}),
    ...(mark ? { mark } : {}),
    ...(changesRequestedAt ? { changesRequestedAt } : {}),
  };
}

export type ParsedPr = PrRow;

/** What a search found: the pull requests it read, and how many it found in all. */
export interface Found {
  prs: ParsedPr[];
  total: number;
}

export interface ListAnswer {
  /** The upper part: at most SEARCH_LIMIT, and how many more GitHub found (each once). */
  requested: { prs: ParsedPr[]; more: number };
  watched: Found[];
  /** By count search, how many. */
  counts: number[];
  /** By search of the open pull requests kept for their review worktree: the URLs found, and whether that is all. */
  kept: { urls: string[]; all: boolean }[];
  /** By lookup, the pull requests found. */
  lookups: ParsedPr[][];
  /** GitHub's words for what it could not answer (the rest is answered). */
  errors: string[];
}

const NONE: Found = { prs: [], total: 0 };

function searchResult(v: unknown): Found | undefined {
  if (!isRecord(v)) return undefined;
  const nodes = Array.isArray(v.nodes) ? v.nodes : [];
  const prs = nodes.flatMap((n) => {
    const pr = parsePr(n);
    return pr ? [pr] : [];
  });
  return { prs, total: Math.max(nodes.length, typeof v.issueCount === "number" ? v.issueCount : 0) };
}

/** A pull request of the upper part, with what GitHub gave for it to sort by. */
interface Ranked {
  pr: ParsedPr;
  rank: number;
}

const totalOf = (v: unknown): number => (isRecord(v) && typeof v.totalCount === "number" ? v.totalCount : 0);
const issueCountOf = (v: unknown): number => (isRecord(v) && typeof v.issueCount === "number" ? v.issueCount : 0);
const timeOf = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** The reactions `sort:reactions-<name>` counts, by the names GitHub has for them in its answers. */
const REACTION_NAMES: Record<string, string> = { "+1": "THUMBS_UP", "-1": "THUMBS_DOWN", smile: "LAUGH", tada: "HOORAY", thinking_face: "CONFUSED", heart: "HEART", rocket: "ROCKET", eyes: "EYES" };

/**
 * Where the search words put a pull request as GitHub answers it, the smaller first: by the first `sort:`, in any case.
 * One GitHub does not know, like none, is the newest first.
 */
function rankOf(words: string): (raw: Record<string, unknown>) => number {
  const asked = splitWords(words).find((w) => w.startsWith("sort:"))?.slice("sort:".length).toLowerCase() ?? "";
  const m = /^(created|updated|comments|interactions|reactions(?:-(\+1|-1|smile|tada|thinking_face|heart|rocket|eyes))?)(?:-(asc|desc))?$/.exec(asked);
  const by = m?.[1] ?? "created";
  const reaction = m?.[2] ? REACTION_NAMES[m[2]] : undefined;
  const comments = (raw: Record<string, unknown>) => (typeof raw.totalCommentsCount === "number" ? raw.totalCommentsCount : 0);
  const key = (raw: Record<string, unknown>): number => {
    if (by === "updated") return timeOf(raw.updatedAt);
    if (by === "comments") return comments(raw);
    if (by === "interactions") return comments(raw) + totalOf(raw.reactions);
    if (reaction) {
      const groups = Array.isArray(raw.reactionGroups) ? raw.reactionGroups : [];
      return totalOf((groups.find((g) => isRecord(g) && g.content === reaction) as { reactors?: unknown } | undefined)?.reactors);
    }
    return by === "created" ? timeOf(raw.createdAt) : totalOf(raw.reactions);
  };
  const sign = m?.[3] === "asc" ? 1 : -1;
  return (raw) => sign * key(raw);
}

/** One of the upper part's searches: what it found, how many GitHub counted, and the nodes that are not to be shown. */
function upperResult(v: unknown, rank: (raw: Record<string, unknown>) => number, keep: (pr: ParsedPr) => boolean = () => true): { list: Ranked[]; count: number; skipped: number } {
  const nodes = isRecord(v) && Array.isArray(v.nodes) ? v.nodes : [];
  const list = nodes.flatMap((raw): Ranked[] => {
    const pr = parsePr(raw);
    return pr && isRecord(raw) && keep(pr) ? [{ pr, rank: rank(raw) }] : [];
  });
  return { list, count: issueCountOf(v), skipped: nodes.length - list.length };
}

/**
 * The upper part from its searches: each pull request once, in the order of the search words, up to the limit of one
 * search. Each search is in that order and holds its first SEARCH_LIMIT, so the first of them all are there. Mine are
 * only ever of the repositories searched, whatever else the search words could make GitHub find.
 */
function upperAnswer(data: Record<string, unknown>, words: string, searches: Pick<UpperSearches, "own" | "both" | "repos">): { prs: ParsedPr[]; more: number } {
  const login = str((data.viewer as { login?: unknown } | null | undefined)?.login);
  const wanted = ownWanted(words, login);
  const rank = rankOf(words);
  const repos = new Set(searches.repos.map((r) => r.toLowerCase()));
  const asked = upperResult(data.req, rank);
  const mine = wanted ? searches.own.map((_, i) => upperResult(data[`own${i}`], rank, (pr) => repos.has(pr.repo.toLowerCase()))) : [];
  const prs: ParsedPr[] = [];
  const seen = new Set<string>();
  for (const next of mergeOrdered([asked.list, ...mine.map((m) => m.list)], (x) => x.rank)) {
    if (prs.length >= SEARCH_LIMIT) break;
    if (seen.has(next.pr.url)) continue;
    seen.add(next.pr.url);
    prs.push({ ...next.pr, order: next.rank });
  }
  // Those found as both count once; GitHub's count of them may be missing when it could not answer that search.
  const urls = new Set(asked.list.map((x) => x.pr.url));
  const counted = searches.both.reduce((n, _, i) => n + issueCountOf(data[`both${i}`]), 0);
  const both = wanted ? Math.max(counted, mine.flatMap((m) => m.list).filter((x) => urls.has(x.pr.url)).length) : 0;
  const found = mine.reduce((n, m) => n + m.count - m.skipped, asked.count - asked.skipped);
  return { prs, more: Math.max(0, found - both - prs.length) };
}

/**
 * The answer of listArgs' query, for the search words `words`. GitHub answers what it can and lists the rest in `errors`
 * (a review worktree whose number is no pull request, say); gh then fails, with the answer on its output.
 */
export function parseList(json: string, p: Pick<ListAsk, "watched" | "counts" | "kept" | "lookups"> & { words?: string; upper?: Pick<UpperSearches, "own" | "both" | "repos"> }): ListAnswer {
  const body = JSON.parse(json) as { data?: Record<string, unknown> | null; errors?: unknown };
  const data = body.data ?? {};
  const errors = (Array.isArray(body.errors) ? body.errors : []).flatMap((e) => {
    const m = str((e as { message?: unknown } | null)?.message);
    return m ? [m.slice(0, 300)] : [];
  });
  return {
    requested: upperAnswer(data, p.words ?? "", p.upper ?? { own: [], both: [], repos: [] }),
    watched: p.watched.map((_, i) => searchResult(data[`w${i}`]) ?? NONE),
    counts: p.counts.map((_, i) => {
      const n = (data[`c${i}`] as { issueCount?: unknown } | null | undefined)?.issueCount;
      return typeof n === "number" ? n : 0;
    }),
    kept: p.kept.map((_, i) => {
      const v = data[`k${i}`];
      const nodes = isRecord(v) && Array.isArray(v.nodes) ? v.nodes : [];
      const urls = nodes.flatMap((n) => (isRecord(n) && typeof n.url === "string" ? [n.url] : []));
      // A search GitHub did not answer says nothing for sure.
      return { urls, all: isRecord(v) && typeof v.issueCount === "number" && v.issueCount <= urls.length };
    }),
    lookups: p.lookups.map((l, i) => {
      const repo = data[`l${i}`];
      if (!isRecord(repo)) return [];
      return [...new Set(l.numbers)].flatMap((n) => {
        const pr = parsePr(repo[`p${n}`]);
        return pr ? [pr] : [];
      });
    }),
    errors: [...new Set(errors)],
  };
}

/** Why a `gh` call failed, for the person looking at the page. */
export function ghError(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; stderr?: unknown; message?: unknown; killed?: unknown };
  if (err.code === "ENOENT") {
    return "この working server に GitHub CLI（gh）がありません。gh を入れて、gh auth login でログインしてください。";
  }
  if (err.killed === true) return "GitHub からの応答が遅く、読み込めませんでした。";
  const text = [err.stderr, err.message].filter((t): t is string => typeof t === "string").join("\n");
  if (/gh auth login|not logged in|authentication/i.test(text)) {
    return "この working server の GitHub CLI（gh）がログインしていません。working server で gh auth login を実行してください。";
  }
  if (/Could not resolve to a PullRequest/i.test(text)) return "この番号の Pull request は見つかりません。";
  if (/Could not resolve to a Repository|HTTP 404|not found/i.test(text)) {
    return "GitHub でこのリポジトリを読めませんでした。gh でログインしているアカウントに権限がないか、リポジトリがありません。";
  }
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("Command failed"));
  return `GitHub から読み込めませんでした：${(first ?? "原因が分かりません").slice(0, 200)}`;
}

/**
 * The query that reads the names GitHub has now for repositories named as their clones' origin says. A repository
 * whose owner or name changed since (an organization renamed, say) still answers to the old name, but GitHub's search
 * takes only the new one, and the pull requests it gives say only the new one.
 */
export function namesArgs(repos: readonly string[]): string[] {
  const decls: string[] = [];
  const fields: string[] = [];
  const vars: string[] = [];
  repos.forEach((r, i) => {
    const [owner, name] = r.split("/") as [string, string];
    decls.push(`$o${i}: String!`, `$n${i}: String!`);
    fields.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { nameWithOwner }`);
    vars.push("-f", `o${i}=${owner}`, "-f", `n${i}=${name}`);
  });
  return ["api", "graphql", "-f", `query=query(${decls.join(", ")}) { ${fields.join(" ")} }`, ...vars];
}

/** The answer of namesArgs' query: each repository GitHub found, by the name it was asked with. */
export function parseNames(json: string, repos: readonly string[]): Map<string, string> {
  const data = (JSON.parse(json) as { data?: Record<string, unknown> | null }).data ?? {};
  const out = new Map<string, string>();
  repos.forEach((r, i) => {
    const name = str((data[`r${i}`] as { nameWithOwner?: unknown } | null)?.nameWithOwner);
    if (name && /^[^/\s]+\/[^/\s]+$/.test(name)) out.set(r, name);
  });
  return out;
}

/** The query that reads one pull request's head before its worktree is made or removed. */
export function headArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequest(number: ${Math.trunc(number)}) { ${PR_FIELDS} } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
}

export function parseHead(json: string): ParsedPr | undefined {
  return parsePr((JSON.parse(json) as { data?: { repository?: { pullRequest?: unknown } | null } | null }).data?.repository?.pullRequest);
}

/**
 * The query that tells whether GitHub has a commit in a repository. It still has one a force-push left behind (of a
 * fork's pull request too), and gives null for one never pushed.
 */
export function commitArgs(repo: string, oid: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query = "query($owner: String!, $name: String!, $oid: GitObjectID!) { repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit { oid } } } }";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `oid=${oid}`];
}

export function parseCommit(json: string, oid: string): boolean {
  return (JSON.parse(json) as { data?: { repository?: { object?: { oid?: unknown } | null } | null } | null }).data?.repository?.object?.oid === oid;
}

/** Comments the side panel shows, at most. */
export const DETAIL_COMMENTS = 30;
/** Checks the side panel shows, at most. */
export const DETAIL_CHECKS = 50;

/** The query that reads what the side panel shows of a pull request: its body, its latest comments and its checks. */
export function detailArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const checks =
    `commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: ${DETAIL_CHECKS}) { nodes { __typename ` +
    "... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl description } } } } } } }";
  const query =
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequest(number: ${Math.trunc(number)}) { ${PR_FIELDS} body ` +
    `comments(last: ${DETAIL_COMMENTS}) { totalCount nodes { author { login } viewerDidAuthor body url createdAt } } ${checks} } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
}

const RUN_STATES: Record<string, CheckRunState> = {
  SUCCESS: "success",
  FAILURE: "failure",
  TIMED_OUT: "failure",
  CANCELLED: "failure",
  ACTION_REQUIRED: "failure",
  STARTUP_FAILURE: "failure",
  ERROR: "failure",
  NEUTRAL: "neutral",
  SKIPPED: "skipped",
  STALE: "neutral",
  PENDING: "pending",
  EXPECTED: "pending",
};

function parseCheck(n: unknown): PrCheck | undefined {
  if (!isRecord(n)) return undefined;
  const url = (u: unknown) => {
    const v = str(u);
    return v?.startsWith("https://") ? { url: v } : {};
  };
  if (n.__typename === "CheckRun") {
    const name = str(n.name);
    if (!name) return undefined;
    // A run that has not completed has no conclusion yet.
    const state = str(n.status) === "COMPLETED" ? (RUN_STATES[str(n.conclusion) ?? ""] ?? "neutral") : "pending";
    return { name, state, ...url(n.detailsUrl) };
  }
  if (n.__typename === "StatusContext") {
    const name = str(n.context);
    if (!name) return undefined;
    const description = str(n.description);
    return { name, state: RUN_STATES[str(n.state) ?? ""] ?? "neutral", ...url(n.targetUrl), ...(description ? { description } : {}) };
  }
  return undefined;
}

/** The answer of detailArgs' query, without where the pull request is (the caller adds it); undefined when there is none. */
export function parseDetail(json: string): PrDetail | undefined {
  const raw = (JSON.parse(json) as { data?: { repository?: { pullRequest?: unknown } | null } | null }).data?.repository?.pullRequest;
  const pr = parsePr(raw);
  if (!pr || !isRecord(raw)) return undefined;
  const comments = parseComments(raw.comments);
  const total = isRecord(raw.comments) && typeof raw.comments.totalCount === "number" ? raw.comments.totalCount : comments.length;
  // The panel's verdict comes from all the comments it reads, not only the latest few of the list.
  const mark = latestMark(comments) ?? pr.mark;
  const commit = ((raw.commits as { nodes?: unknown[] } | null)?.nodes?.[0] as { commit?: { statusCheckRollup?: { contexts?: { nodes?: unknown[] } } | null } } | undefined)
    ?.commit;
  const checks = (commit?.statusCheckRollup?.contexts?.nodes ?? []).flatMap((n) => {
    const c = parseCheck(n);
    return c ? [c] : [];
  });
  return {
    pr: { ...pr, ...(mark ? { mark } : {}) },
    body: typeof raw.body === "string" ? raw.body : "",
    comments,
    commentsMore: Math.max(0, total - comments.length),
    checks,
  };
}
