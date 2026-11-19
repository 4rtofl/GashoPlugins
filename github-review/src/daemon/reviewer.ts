// The review page of one working server: which repositories it watches (kept in the plugin's own folder, ctx.dataDir),
// the clones in the folders Gasho can start sessions in, and the pull requests the page lists, each with where it is
// here. The web part asks for the list every minute while the page shows; gasho-daemon answers gh from what it kept
// when the same query was read within 30 seconds, so however many browsers look, GitHub is read about once a minute.
// Listing the folders can take a minute on a busy working server: the answers use the list made last while it is made
// again.
import fs from "node:fs/promises";
import path from "node:path";
import { cleanable, cleanupDone } from "../cleanup.ts";
import { reviewPosted } from "../review-session.ts";
import { inOrder, openWords } from "../search.ts";
import { MAX_QUERY, MAX_REPOS, SEARCH_LIMIT, type Listing, type Place, type PrDetail, type PrRow, type RepoOption, type RepoPrs } from "../types.ts";
import { countQuery, detailArgs, ghError, inScope, listArgs, namesArgs, parseDetail, parseList, parseNames, scopeWords, upperSearches, watchedQueries, type ListAsk, type Lookup, type ParsedPr } from "./gh.ts";
import type { Cleanups } from "./cleanups.ts";
import type { SessionRemovals } from "./session-removals.ts";
import { inParallel, PARALLEL_GIT, prWorktree, readClone, repoOptions, ReviewError, reviewNumbers, worktreesStamp, type Clone, type Exec } from "./git.ts";

export type GitHubRead = (args: string[], o?: { maxAgeSeconds?: number; timeoutMs?: number; maxBuffer?: number }) => Promise<{ stdout: string }>;

/** The repositories that can be watched are listed again when the folders change, or when the list is this old. */
const OPTIONS_MAX_AGE_MS = 5 * 60_000;
/** The names GitHub has for the repositories of the clones' origins are read again when this old. */
const NAMES_MAX_AGE_MS = 60 * 60_000;

const sameRepo = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export interface ReviewerDeps {
  exec: Exec;
  /** The folders Gasho can start sessions in (ctx.folders). */
  folders: () => string[];
  /** The file that keeps the watched repositories. */
  file: string;
  log: (...args: unknown[]) => void;
  now?: () => number;
  /** The review worktrees to remove once what was asked is done. */
  cleanups?: Cleanups;
  /** The sessions to remove once the review sent to them is posted. */
  removals?: SessionRemovals;
}

/** A pull request as the page gets it, with where it is here. */
function row(pr: ParsedPr, place: Place | undefined): PrRow {
  return { ...pr, ...(place ? { place } : {}) };
}

type PrRef = { number: number; branch: string; fork?: boolean };

export class Reviewer {
  private deps: ReviewerDeps;
  private now: () => number;
  private watched: string[] = [];
  /** The file of the watched repositories could not be read as JSON: they start from none, and the page says so. */
  private broken = false;
  private loaded: Promise<void> | undefined;
  private options: { at: number; folders: string; list: RepoOption[] } | undefined;
  private listing: Promise<RepoOption[]> | undefined;
  /** By the name an origin says (in lower case), the name GitHub has now, and when it was read. */
  private names = new Map<string, { name: string; at: number }>();
  /** By primary checkout, its worktrees as git listed them last, and the stamp of the files that list came from. */
  private read = new Map<string, { stamp: string; clone: Clone }>();

  constructor(deps: ReviewerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** Reads the watched repositories from the file, once. */
  load(): Promise<void> {
    this.loaded ??= fs.readFile(this.deps.file, "utf8").then(
      (raw) => {
        let v: { paths?: unknown } | null;
        try {
          v = JSON.parse(raw) as { paths?: unknown } | null;
        } catch (e) {
          // Choosing them again writes the file anew.
          this.broken = true;
          this.deps.log("github-review: the file of the watched repositories is broken; starting with none", e);
          return;
        }
        const paths = Array.isArray(v?.paths) ? v.paths.filter((p): p is string => typeof p === "string") : [];
        this.watched = [...new Set(paths)].slice(0, MAX_REPOS);
      },
      (e: unknown) => {
        if ((e as { code?: unknown }).code !== "ENOENT") this.deps.log("github-review: could not read the watched repositories", e);
      },
    );
    return this.loaded;
  }

  /** Lists the repositories in the folders again (once at a time). */
  private relist(): Promise<RepoOption[]> {
    const folders = this.deps.folders();
    this.listing ??= repoOptions(this.deps.exec, folders)
      .then(
        (list) => {
          this.options = { at: this.now(), folders: JSON.stringify(folders), list };
          return list;
        },
        (e: unknown) => {
          this.deps.log("github-review: could not list the repositories", e);
          throw e;
        },
      )
      .finally(() => {
        this.listing = undefined;
      });
    return this.listing;
  }

  /**
   * The repositories that can be watched. A list of the same folders younger than `maxAgeMs` is used as it is; an
   * older one, or one of other folders, is listed again. With `stale`, the old list is used meanwhile, so that the
   * answer does not wait for git in every folder; otherwise (or without a list) this waits for the new one.
   */
  repoOptions(o: { maxAgeMs?: number; stale?: boolean } = {}): Promise<RepoOption[]> {
    const c = this.options;
    if (c && c.folders === JSON.stringify(this.deps.folders()) && this.now() - c.at < (o.maxAgeMs ?? OPTIONS_MAX_AGE_MS)) return Promise.resolve(c.list);
    const next = this.relist();
    if (!c || !o.stale) return next;
    next.catch(() => {});
    return Promise.resolve(c.list);
  }

  /** What the "対象リポジトリ" dialog offers: listed again first when the folders changed; else at most 30 seconds old, or behind the answer. */
  offered(): Promise<RepoOption[]> {
    return this.repoOptions({ maxAgeMs: 30_000, stale: this.options?.folders === JSON.stringify(this.deps.folders()) });
  }

  /** The repositories watched, as chosen. */
  async watching(): Promise<string[]> {
    await this.load();
    return [...this.watched];
  }

  /** Watches `paths` from now on: each a repository on GitHub that can be watched now, or one watched already. */
  async watch(paths: unknown): Promise<string[]> {
    await this.load();
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) throw new ReviewError("対象リポジトリの指定が正しくありません。");
    const next = [...new Set(paths as string[])];
    if (next.length > MAX_REPOS) throw new ReviewError(`対象リポジトリは、1 台の working server に ${MAX_REPOS} 個までです。`);
    const added = next.filter((p) => !this.watched.includes(p));
    if (added.length > 0) {
      // What the dialog was offered, as it was: listing the folders again can take longer than this call may wait.
      const offered = async (o: { maxAgeMs?: number; stale?: boolean }) => new Set((await this.repoOptions(o)).filter((x) => x.github).map((x) => x.path));
      let ok = await offered({ stale: true });
      if (added.some((p) => !ok.has(p))) ok = await offered({ maxAgeMs: 30_000 });
      const bad = added.filter((p) => !ok.has(p));
      if (bad.length > 0) throw new ReviewError(`選べない repo です：${bad.join("、")}`);
    }
    if (this.broken || JSON.stringify(next) !== JSON.stringify(this.watched)) {
      await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
      const tmp = `${this.deps.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ paths: next }, null, 2)}\n`);
      await fs.rename(tmp, this.deps.file);
      this.watched = next;
      this.broken = false;
    }
    return [...this.watched];
  }

  /**
   * The repositories with the names GitHub has now: an origin may still say a name from before a repository or its
   * owner was renamed, which GitHub's search does not take and its pull requests do not say. One GitHub does not find,
   * or when GitHub cannot be read, keeps its origin's name.
   */
  private async named(github: GitHubRead, options: RepoOption[]): Promise<RepoOption[]> {
    const stale = [...new Set(options.flatMap((o) => (o.github ? [o.github] : [])))].filter((r) => {
      const n = this.names.get(r.toLowerCase());
      return !n || this.now() - n.at >= NAMES_MAX_AGE_MS;
    });
    if (stale.length > 0) {
      let json: string | undefined;
      try {
        json = (await github(namesArgs(stale), { timeoutMs: 20_000 })).stdout;
      } catch (e) {
        // GitHub answers the repositories it finds and fails for the others, with the answer on its output.
        const out = (e as { stdout?: unknown } | null)?.stdout;
        if (typeof out === "string" && out.includes('"data"')) json = out;
        else this.deps.log("github-review: could not read the names of the repositories on GitHub", e);
      }
      if (json !== undefined) {
        const found = parseNames(json, stale);
        // One GitHub does not find keeps its own name, until it is read again.
        for (const r of stale) this.names.set(r.toLowerCase(), { name: found.get(r) ?? r, at: this.now() });
      }
    }
    return options.map((o) => (o.github ? { ...o, github: this.names.get(o.github.toLowerCase())?.name ?? o.github } : o));
  }

  /**
   * The clones of the repositories on GitHub, as they are now; a clone git cannot read is left out. One whose files
   * git's list of worktrees depends on are as they were (worktreesStamp) is not read with git again.
   */
  private async clones(options: RepoOption[]): Promise<Clone[]> {
    const on = options.flatMap((o) => (o.github ? [{ path: o.path, github: o.github }] : []));
    const read = await inParallel(on, PARALLEL_GIT, async (o) => {
      const stamp = await worktreesStamp(o.path);
      const kept = this.read.get(o.path);
      if (stamp && kept?.stamp === stamp) return { ...kept.clone, github: o.github };
      try {
        const clone = await readClone(this.deps.exec, o);
        // The stamp is from before git read it: a change in between is read again next time.
        if (stamp) this.read.set(o.path, { stamp, clone });
        return clone;
      } catch (e) {
        this.deps.log(`github-review: could not read the worktrees of ${o.path}`, e);
        return undefined;
      }
    });
    for (const p of this.read.keys()) if (!on.some((o) => o.path === p)) this.read.delete(p);
    return read.filter((c): c is Clone => c !== undefined);
  }

  /**
   * The clone of `repo` to use: the one with the pull request's worktree, else the watched one, else the first by path.
   * The page and the making of a worktree choose alike, so that a worktree is made where the page looks for it.
   */
  private choose(clones: Clone[], repo: string, pr?: PrRef): Clone | undefined {
    const all = clones.filter((c) => sameRepo(c.github, repo)).sort((a, b) => a.path.localeCompare(b.path));
    return (pr && all.find((c) => prWorktree(c, pr))) ?? all.find((c) => this.watched.includes(c.path)) ?? all[0];
  }

  /**
   * The clone of `repo` (the name GitHub has now) as it is now, for `pr`. `wait`: when the list of the folders has no
   * clone of it, it is listed again first (a clone trusted since), as making or removing a worktree may wait for that.
   */
  async cloneOf(github: GitHubRead, repo: string, o: { pr?: PrRef; wait?: boolean } = {}): Promise<Clone | undefined> {
    await this.load();
    const of = async (r: { maxAgeMs?: number; stale?: boolean }) => (await this.named(github, await this.repoOptions(r))).filter((x) => x.github && sameRepo(x.github, repo));
    let options = await of({ stale: true });
    if (options.length === 0 && o.wait) options = await of({ maxAgeMs: 30_000 });
    return this.choose(await this.clones(options), repo, o.pr);
  }

  /**
   * What the side panel shows of `repo`#`number` (the name GitHub has now), with where it is here. `fresh`: without
   * what gasho-daemon kept of gh.
   */
  async detail(github: GitHubRead, repo: string, number: number, fresh: boolean): Promise<PrDetail> {
    let json: string;
    try {
      json = (await github(detailArgs(repo, number), { timeoutMs: 20_000, maxBuffer: 8 * 1024 * 1024, ...(fresh ? { maxAgeSeconds: 0 } : {}) })).stdout;
    } catch (e) {
      throw new ReviewError(ghError(e));
    }
    const d = parseDetail(json);
    if (!d) throw new ReviewError(`${repo} に Pull request #${number} はありません。`);
    const clone = await this.cloneOf(github, d.pr.repo, { pr: d.pr }).catch((e: unknown) => {
      this.deps.log(`github-review: could not read the clone of ${d.pr.repo}`, e);
      return undefined;
    });
    if (clone) {
      const worktree = prWorktree(clone, d.pr);
      const sent = (await this.deps.removals?.all().catch(() => [])) ?? [];
      const reviewSessions = sent.filter((x) => sameRepo(x.repo, d.pr.repo) && x.number === d.pr.number).map((x) => x.sessionId);
      d.pr.place = { primary: clone.path, ...(worktree ? { worktree } : {}), ...(reviewSessions.length > 0 ? { reviewSessions } : {}) };
    }
    return d;
  }

  /**
   * The page: the open pull requests I am asked to review and those I opened in the watched repositories, the watched
   * repositories' (all narrowed by `words`, GitHub's search words), and those with a review worktree here that none
   * lists (closed ones, say), so they can be removed. `fresh`: without what gasho-daemon kept of gh.
   */
  async list(github: GitHubRead, words: unknown, fresh: boolean): Promise<Listing> {
    await this.load();
    const q = typeof words === "string" ? words.trim() : "";
    if (q.length > MAX_QUERY || /[\r\n]/.test(q)) throw new ReviewError(`検索の語が正しくありません（${MAX_QUERY} 文字まで、1 行）。`);
    const options = await this.named(
      github,
      await this.repoOptions({ stale: true }).catch(() => this.options?.list ?? []),
    );
    const clones = await this.clones(options);
    const errors: string[] = [];
    if (this.broken) errors.push("対象リポジトリを覚えたファイル（watched.json）が壊れていたので、空から始めました。「対象リポジトリ」で選び直してください。");
    const watchedRepos: string[] = [];
    for (const p of this.watched) {
      const o = options.find((x) => x.path === p);
      if (!o) errors.push(`${p}：Claude Code が信頼しているフォルダーの repo ではないので、見られません。`);
      else if (!o.github) errors.push(`${p}：origin が GitHub の repo ではないので、見られません。`);
      else if (!watchedRepos.some((r) => sameRepo(r, o.github ?? ""))) watchedRepos.push(o.github);
    }
    const isWatched = (r: string) => watchedRepos.some((w) => sameRepo(w, r));
    // A merged pull request leaves the lists: those asked to be cleaned up are read too, whatever their worktree's name.
    const cleanups = this.deps.cleanups;
    const followed = (await cleanups?.all().catch(() => [])) ?? [];
    const lookups: Lookup[] = [];
    for (const c of clones) {
      const numbers = [...reviewNumbers(c), ...followed.filter((e) => sameRepo(e.repo, c.github)).map((e) => e.number)];
      if (numbers.length === 0) continue;
      const l = lookups.find((x) => sameRepo(x.repo, c.github));
      if (l) l.numbers.push(...numbers);
      else lookups.push({ repo: c.github, numbers });
    }
    // repo:, org:, user: and owner: narrow the watched repositories (GitHub would take them with the watched ones as
    // "any of").
    const scope = scopeWords(q);
    const rest = scope.rest;
    const searched = watchedRepos.filter((r) => inScope(scope, r));
    // The open pull requests with a review worktree in a repository that is not watched show when the words find them.
    const open = openWords(rest);
    const keptRepos = open === undefined ? [] : lookups.map((l) => l.repo).filter((r) => !isWatched(r) && inScope(scope, r));
    const upper = upperSearches(q, watchedRepos);
    const asked: ListAsk = {
      requested: upper.requested,
      own: upper.own,
      both: upper.both,
      watched: watchedQueries(searched, rest),
      counts: searched.length > 1 ? searched.map((r) => countQuery(r, rest)) : [],
      kept: open === undefined ? [] : watchedQueries(keptRepos, `is:open ${open}`.trim()),
      lookups,
    };
    let json: string;
    try {
      json = (await github(listArgs(asked), { timeoutMs: 30_000, maxBuffer: 16 * 1024 * 1024, ...(fresh ? { maxAgeSeconds: 0 } : {}) })).stdout;
    } catch (e) {
      // GitHub answered what it could: gh fails, with the answer on its output.
      const out = (e as { stdout?: unknown } | null)?.stdout;
      if (typeof out !== "string" || !out.includes('"data"')) throw new ReviewError(ghError(e));
      json = out;
    }
    const answer = parseList(json, { ...asked, words: q, upper });
    errors.push(...answer.errors.map((m) => `GitHub：${m}`));

    // Those whose worktree is gone from every clone of their repository here are forgotten. A worktree of another name
    // is found by the pull request's branch: one GitHub did not answer for is kept until it does.
    if (cleanups) {
      const read = [...answer.requested.prs, ...answer.watched.flatMap((w) => w.prs), ...answer.lookups.flat()];
      await cleanups
        .prune((e) => {
          const of = clones.filter((c) => sameRepo(c.github, e.repo));
          if (of.length === 0 || of.some((c) => reviewNumbers(c).includes(e.number))) return false;
          const pr = read.find((p) => sameRepo(p.repo, e.repo) && p.number === e.number);
          return pr !== undefined && !of.some((c) => {
            const w = prWorktree(c, pr);
            return w !== undefined && cleanable(e.kind, w, c.path);
          });
        })
        .catch((e: unknown) => this.deps.log("github-review: could not forget the worktrees cleaned up", e));
    }
    const toClean = (await cleanups?.all().catch(() => [])) ?? [];
    const sent = (await this.deps.removals?.all().catch(() => [])) ?? [];
    const placeOf = (pr: ParsedPr): Place | undefined => {
      const c = this.choose(clones, pr.repo, pr);
      if (!c) return undefined;
      const worktree = prWorktree(c, pr);
      const e = worktree && toClean.find((x) => sameRepo(x.repo, pr.repo) && x.number === pr.number && cleanable(x.kind, worktree, c.path));
      const cleanup = e && { kind: e.kind, ...(e.sha ? { sha: e.sha } : {}), done: cleanupDone(e.kind, pr, e.at), ...(e.problem ? { problem: e.problem } : {}) };
      const reviews = sent.filter((x) => sameRepo(x.repo, pr.repo) && x.number === pr.number);
      const finishedSessions = reviews.filter((x) => reviewPosted(pr.mark, x)).map((x) => x.sessionId);
      return {
        primary: c.path,
        ...(worktree ? { worktree } : {}),
        ...(cleanup ? { cleanup } : {}),
        ...(finishedSessions.length > 0 ? { finishedSessions } : {}),
        ...(reviews.length > 0 ? { reviewSessions: reviews.map((x) => x.sessionId) } : {}),
      };
    };
    const requested = answer.requested.prs;
    const read = answer.watched.flatMap((w) => w.prs);
    // The newest of all the watched repositories', however many searches they took. A repository's count comes from
    // its own search when the searches hold several.
    const seen = new Set<string>();
    const found = inOrder(
      read.filter((p) => !seen.has(p.url) && Boolean(seen.add(p.url))),
      q,
    ).slice(0, SEARCH_LIMIT);
    const totals = new Map(searched.map((r, i) => [r.toLowerCase(), (searched.length > 1 ? answer.counts[i] : answer.watched[0]?.total) ?? 0]));
    const repos: RepoPrs[] = watchedRepos.map((repo) => ({
      repo,
      watched: true,
      prs: found.filter((p) => sameRepo(p.repo, repo)).map((p) => row(p, placeOf(p))),
      total: totals.get(repo.toLowerCase()) ?? 0,
      kept: [],
    }));
    // What the searches read, past the first ones too: those count in their repository's total.
    const shown = new Set([...requested, ...read].map((p) => p.url));
    const keptUrls = new Set(answer.kept.flatMap((k) => k.urls));
    const keptAll = answer.kept.every((k) => k.all);
    for (const pr of answer.lookups.flat()) {
      const place = placeOf(pr);
      if (shown.has(pr.url) || !(place?.worktree?.review || place?.cleanup)) continue;
      // An open one shows when the words find it: in a watched repository the search says (one past the first ones is
      // in its total), else the search of those repositories, when it read all it found.
      if (pr.state === "open" && (isWatched(pr.repo) || open === undefined || !inScope(scope, pr.repo) || (keptAll && !keptUrls.has(pr.url)))) continue;
      shown.add(pr.url);
      const group = repos.find((r) => sameRepo(r.repo, pr.repo));
      if (group) group.kept.push(row(pr, placeOf(pr)));
      else repos.push({ repo: pr.repo, watched: false, prs: [], total: 0, kept: [row(pr, placeOf(pr))] });
    }
    return {
      watched: [...this.watched],
      requested: requested.map((p) => row(p, placeOf(p))),
      ...(answer.requested.more ? { requestedMore: answer.requested.more } : {}),
      repos,
      errors,
    };
  }
}
