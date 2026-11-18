// The review page of one working server: which repositories it watches (kept in the plugin's own folder, ctx.dataDir),
// the clones in the folders Gasho can start sessions in, and the pull requests the page lists, each with where it is
// here. The web part asks for the list every minute while the page shows; gasho-daemon answers gh from what it kept
// when the same query was read within 30 seconds, so however many browsers look, GitHub is read about once a minute.
import fs from "node:fs/promises";
import path from "node:path";
import { cleanable, cleanupDone } from "../cleanup.ts";
import { reviewPosted } from "../review-session.ts";
import { MAX_QUERY, MAX_REPOS, type Listing, type Place, type PrDetail, type PrRow, type RepoOption, type RepoPrs } from "../types.ts";
import { detailArgs, ghError, listArgs, namesArgs, parseDetail, parseList, parseNames, upperSearches, watchedQueries, type Lookup, type ParsedPr } from "./gh.ts";
import type { Cleanups } from "./cleanups.ts";
import type { SessionRemovals } from "./session-removals.ts";
import { prWorktree, readClone, repoOptions, ReviewError, reviewNumbers, type Clone, type Exec } from "./git.ts";

export type GitHubRead = (args: string[], o?: { maxAgeSeconds?: number; timeoutMs?: number; maxBuffer?: number }) => Promise<{ stdout: string }>;

/** The repositories that can be watched are listed again when the folders change, or when the list is this old. */
const OPTIONS_MAX_AGE_MS = 5 * 60_000;
/** Clones read at the same time (each is `git worktree list`). */
const PARALLEL = 4;
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

export class Reviewer {
  private deps: ReviewerDeps;
  private now: () => number;
  private watched: string[] = [];
  private loaded: Promise<void> | undefined;
  private options: { at: number; folders: string; list: RepoOption[] } | undefined;
  private listing: Promise<RepoOption[]> | undefined;
  /** By the name an origin says (in lower case), the name GitHub has now, and when it was read. */
  private names = new Map<string, { name: string; at: number }>();

  constructor(deps: ReviewerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** Reads the watched repositories from the file, once. */
  load(): Promise<void> {
    this.loaded ??= fs.readFile(this.deps.file, "utf8").then(
      (raw) => {
        const v = JSON.parse(raw) as { paths?: unknown } | null;
        const paths = Array.isArray(v?.paths) ? v.paths.filter((p): p is string => typeof p === "string") : [];
        this.watched = [...new Set(paths)].slice(0, MAX_REPOS);
      },
      (e: unknown) => {
        if ((e as { code?: unknown }).code !== "ENOENT") this.deps.log("github-review: could not read the watched repositories", e);
      },
    );
    return this.loaded;
  }

  /** The repositories that can be watched, listed again when the folders changed or the list is older than `maxAgeMs`. */
  repoOptions(maxAgeMs = OPTIONS_MAX_AGE_MS): Promise<RepoOption[]> {
    const folders = this.deps.folders();
    const key = JSON.stringify(folders);
    const c = this.options;
    if (c && c.folders === key && this.now() - c.at < maxAgeMs) return Promise.resolve(c.list);
    this.listing ??= repoOptions(this.deps.exec, folders)
      .then((list) => {
        this.options = { at: this.now(), folders: key, list };
        return list;
      })
      .finally(() => {
        this.listing = undefined;
      });
    return this.listing;
  }

  /** Watches `paths` from now on: each a repository on GitHub that can be watched now, or one watched already. */
  async watch(paths: unknown): Promise<string[]> {
    await this.load();
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) throw new ReviewError("対象リポジトリの指定が正しくありません。");
    const next = [...new Set(paths as string[])];
    if (next.length > MAX_REPOS) throw new ReviewError(`対象リポジトリは、1 台の working server に ${MAX_REPOS} 個までです。`);
    const added = next.filter((p) => !this.watched.includes(p));
    if (added.length > 0) {
      const offered = new Set((await this.repoOptions(30_000)).filter((o) => o.github).map((o) => o.path));
      const bad = added.filter((p) => !offered.has(p));
      if (bad.length > 0) throw new ReviewError(`選べない repo です：${bad.join("、")}`);
    }
    if (JSON.stringify(next) !== JSON.stringify(this.watched)) {
      await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
      const tmp = `${this.deps.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ paths: next }, null, 2)}\n`);
      await fs.rename(tmp, this.deps.file);
      this.watched = next;
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

  /** The clones of the repositories on GitHub, as they are now; a clone git cannot read is left out. */
  private async clones(options: RepoOption[]): Promise<Clone[]> {
    const queue = options.flatMap((o) => (o.github ? [{ path: o.path, github: o.github }] : []));
    const out: Clone[] = [];
    const worker = async () => {
      for (let o = queue.shift(); o; o = queue.shift()) {
        try {
          out.push(await readClone(this.deps.exec, o));
        } catch (e) {
          this.deps.log(`github-review: could not read the worktrees of ${o.path}`, e);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The clone of `repo` to use: the watched one when it has several. */
  private pick(clones: Clone[], repo: string): Clone | undefined {
    const all = clones.filter((c) => sameRepo(c.github, repo));
    return all.find((c) => this.watched.includes(c.path)) ?? all[0];
  }

  /** The clone of `repo` (the name GitHub has now) as it is now, for making or removing a worktree. */
  async cloneOf(github: GitHubRead, repo: string): Promise<Clone | undefined> {
    await this.load();
    const option = (await this.named(github, await this.repoOptions())).filter((o) => o.github && sameRepo(o.github, repo));
    const chosen = option.find((o) => this.watched.includes(o.path)) ?? option[0];
    return chosen?.github ? readClone(this.deps.exec, { path: chosen.path, github: chosen.github }) : undefined;
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
    const clone = await this.cloneOf(github, d.pr.repo).catch((e: unknown) => {
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
   * The page: the pull requests I am asked to review, those I opened in the watched repositories, the watched
   * repositories' (all narrowed by `words`, GitHub's search words), and those with a review worktree here that none
   * lists (closed ones, say), so they can be removed.
   * `fresh`: without what gasho-daemon kept of gh.
   */
  async list(github: GitHubRead, words: unknown, fresh: boolean): Promise<Listing> {
    await this.load();
    const q = typeof words === "string" ? words.trim() : "";
    if (q.length > MAX_QUERY || /[\r\n]/.test(q)) throw new ReviewError(`検索の語が正しくありません（${MAX_QUERY} 文字まで、1 行）。`);
    const options = await this.named(
      github,
      await this.repoOptions().catch((e: unknown) => {
        this.deps.log("github-review: could not list the repositories", e);
        return this.options?.list ?? [];
      }),
    );
    const clones = await this.clones(options);
    const errors: string[] = [];
    const watchedRepos: string[] = [];
    for (const p of this.watched) {
      const o = options.find((x) => x.path === p);
      if (!o) errors.push(`${p}：Claude Code が信頼しているフォルダーの repo ではないので、見られません。`);
      else if (!o.github) errors.push(`${p}：origin が GitHub の repo ではないので、見られません。`);
      else if (!watchedRepos.some((r) => sameRepo(r, o.github ?? ""))) watchedRepos.push(o.github);
    }
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
    const upper = upperSearches(q, watchedRepos);
    const asked = { ...upper, watched: watchedQueries(watchedRepos, q), lookups };
    let json: string;
    try {
      json = (await github(listArgs(asked), { timeoutMs: 30_000, maxBuffer: 16 * 1024 * 1024, ...(fresh ? { maxAgeSeconds: 0 } : {}) })).stdout;
    } catch (e) {
      // GitHub answered what it could: gh fails, with the answer on its output.
      const out = (e as { stdout?: unknown } | null)?.stdout;
      if (typeof out !== "string" || !out.includes('"data"')) throw new ReviewError(ghError(e));
      json = out;
    }
    const answer = parseList(json, { watched: asked.watched.length, lookups, words: q, upper });
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
      const c = this.pick(clones, pr.repo);
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
    const watchedPrs = answer.watched.flatMap((w) => w.prs);
    const shown = new Set([...requested, ...watchedPrs].map((p) => p.url));
    const repos: RepoPrs[] = watchedRepos.map((repo) => ({
      repo,
      watched: true,
      // Only the watched repositories': the search words may name others (repo:…).
      prs: watchedPrs.filter((p) => sameRepo(p.repo, repo)).map((p) => row(p, placeOf(p))),
    }));
    for (const pr of answer.lookups.flat()) {
      const place = placeOf(pr);
      if (shown.has(pr.url) || !(place?.worktree?.review || place?.cleanup)) continue;
      shown.add(pr.url);
      const group = repos.find((r) => sameRepo(r.repo, pr.repo));
      if (group) group.prs.push(row(pr, placeOf(pr)));
      else repos.push({ repo: pr.repo, watched: false, prs: [row(pr, placeOf(pr))] });
    }
    const watchedMore = answer.watched.reduce((n, w) => n + w.more, 0);
    return {
      watched: [...this.watched],
      requested: requested.map((p) => row(p, placeOf(p))),
      ...(answer.requested.more ? { requestedMore: answer.requested.more } : {}),
      repos,
      ...(watchedMore ? { watchedMore } : {}),
      errors,
    };
  }
}
