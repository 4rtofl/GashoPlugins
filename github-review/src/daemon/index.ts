// The daemon part of github-review: on each working server, the repositories that can be watched (from the folders
// Gasho can start sessions in), the pull requests of the review page with where each is here, making and removing the
// review worktrees with git, and what Claude Code would read in one. gh runs through gasho-daemon (ctx.github); git
// only in the clones of those folders.
import path from "node:path";
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import { CLEANUP_KINDS, type CleanupKind } from "../cleanup.ts";
import { Cleanups } from "./cleanups.ts";
import { commitArgs, ghError, headArgs, parseCommit, parseHead } from "./gh.ts";
import { createWorktree, projectFiles, removeWorktree, ReviewError, type OnGitHub, type PrHead } from "./git.ts";
import { Reviewer } from "./reviewer.ts";
import { finishedNotification, ReviewSessions } from "./review-sessions.ts";
import { SessionRemovals } from "./session-removals.ts";

let reviewer: Reviewer | undefined;
let cleanups: Cleanups | undefined;
let removals: SessionRemovals | undefined;
let reviewSessions: ReviewSessions | undefined;

function current(): Reviewer {
  if (!reviewer) throw new PluginError("github-review の daemon の部分が、まだ動き始めていません。");
  return reviewer;
}

const objArg = (params: unknown): Record<string, unknown> => (typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {});

/** owner/name of a GitHub repository; never something gh would take as a flag. */
function repoArg(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(v) || v.startsWith("-")) throw new PluginError("リポジトリの指定が正しくありません。");
  return v;
}

function numberArg(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1e9) throw new PluginError("番号が正しくありません。");
  return v;
}

/** The clone of `repo` here. */
async function cloneOf(repo: string, ctx: DaemonContext) {
  const clone = await current().cloneOf((args, o) => ctx.github.read(args, o), repo);
  if (!clone) throw new ReviewError(`この working server の、Claude Code が信頼しているフォルダーに、${repo} の clone がありません。`);
  return clone;
}

/** A commit's SHA, whole or its start (a verdict's mark may hold either), in lower case; undefined when not given. */
function shaArg(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^[0-9a-f]{7,40}$/i.test(v)) throw new PluginError("判定の commit の指定が正しくありません。");
  return v.toLowerCase();
}

/** The pull request as GitHub has it now, and the clone of its repository here: never what the browser says of them. */
async function target(params: unknown, ctx: DaemonContext) {
  const p = objArg(params);
  const repo = repoArg(p.repo);
  const number = numberArg(p.number);
  let pr;
  try {
    pr = parseHead((await ctx.github.read(headArgs(repo, number), { repo, maxAgeSeconds: 0, timeoutMs: 20_000 })).stdout);
  } catch (e) {
    throw new ReviewError(ghError(e));
  }
  if (!pr) throw new ReviewError(`${repo} に Pull request #${number} はありません。`);
  const clone = await cloneOf(repo, ctx);
  const head: PrHead = { number, branch: pr.branch, fork: pr.fork === true, ...(pr.head ? { head: pr.head } : {}) };
  const onGitHub: OnGitHub = async (oid) => {
    try {
      return parseCommit((await ctx.github.read(commitArgs(repo, oid), { repo, timeoutMs: 20_000 })).stdout, oid);
    } catch (e) {
      throw new ReviewError(ghError(e));
    }
  };
  return { clone, head, onGitHub };
}

export default defineDaemonPlugin({
  start(ctx) {
    cleanups = new Cleanups({ file: path.join(ctx.dataDir, "cleanups.json"), log: ctx.log });
    removals = new SessionRemovals({ file: path.join(ctx.dataDir, "session-removals.json"), log: ctx.log });
    reviewer = new Reviewer({ exec: ctx.exec, folders: ctx.folders, file: path.join(ctx.dataDir, "watched.json"), log: ctx.log, cleanups, removals });
    void reviewer.load();
    void cleanups.load();
    void removals.load();
    reviewSessions = new ReviewSessions({ file: path.join(ctx.dataDir, "review-sessions.json"), log: ctx.log });
    void reviewSessions.load();
  },
  stop() {
    reviewer = undefined;
    cleanups = undefined;
    removals = undefined;
    reviewSessions = undefined;
  },
  /**
   * A session that was sent a review ended a turn: once the review of the head now is posted, the notification says so,
   * once. Until then (the Agent asks something, GitHub cannot be read) Gasho's own notification goes out.
   */
  async onSessionStop(ctx) {
    const review = await reviewSessions?.get(ctx.session.sessionId);
    if (!review) return undefined;
    const { stdout } = await ctx.github.read(headArgs(review.repo, review.number), { repo: review.repo, maxAgeSeconds: 0, timeoutMs: 4000 });
    const pr = parseHead(stdout);
    const notification = pr && finishedNotification(pr, review);
    if (notification) await reviewSessions?.forget(ctx.session.sessionId);
    return notification;
  },
  methods: {
    /** The repositories that can be watched: RepoOption[]. */
    async options() {
      return current().repoOptions(30_000);
    },
    /** The page (Listing) for { query } (GitHub's search words); { fresh: true } reads without what gasho-daemon kept of gh. */
    async list(params, ctx) {
      const p = objArg(params);
      return current().list((args, o) => ctx.github.read(args, o), p.query, p.fresh === true);
    },
    /** What the side panel shows of { repo, number } (PrDetail); { fresh: true } reads without what gasho-daemon kept of gh. */
    async detail(params, ctx) {
      const p = objArg(params);
      return current().detail((args, o) => ctx.github.read(args, o), repoArg(p.repo), numberArg(p.number), p.fresh === true);
    },
    /** Watches { paths } (primary checkouts from `options`) from now on; returns them. */
    async watch(params) {
      return current().watch(objArg(params).paths);
    },
    /** Makes the review worktree of { repo, number }, or finds the one it has (Created). */
    async create(params, ctx) {
      const { clone, head, onGitHub } = await target(params, ctx);
      return createWorktree(ctx.exec, clone, head, { onGitHub });
    },
    /**
     * Which of PROJECT_FILES the review worktree of { repo, number } has (ProjectFiles): the page shows them before a
     * session starts in a fork's code.
     */
    async projectFiles(params, ctx) {
      const p = objArg(params);
      return projectFiles(await cloneOf(repoArg(p.repo), ctx), numberArg(p.number));
    },
    /**
     * The review worktree of { repo, number } once what was asked of its Agent is done (cleanup.ts), by `action`:
     * "follow" { kind, sha } — remove it once `kind` ("merge" or "sendBack") is done, asked of the verdict on `sha` (the
     * head its mark names, by which the page tells the ask is of the verdict it shows); "forget" — not to be removed
     * (it was, or the person no longer wants it); "claim" — a page is about to remove it ({ claimed }: false when
     * another page is at it, or it failed before); "fail" { problem } — it could not be removed, and why.
     */
    async cleanup(params) {
      if (!cleanups) throw new PluginError("github-review の daemon の部分が、まだ動き始めていません。");
      const p = objArg(params);
      const repo = repoArg(p.repo);
      const number = numberArg(p.number);
      switch (p.action) {
        case "follow": {
          if (!CLEANUP_KINDS.includes(p.kind as CleanupKind)) throw new PluginError("頼んだことの指定が正しくありません。");
          await cleanups.follow(repo, number, p.kind as CleanupKind, shaArg(p.sha));
          return { ok: true };
        }
        case "forget":
          await cleanups.forget(repo, number);
          return { ok: true };
        case "claim":
          return { claimed: await cleanups.claim(repo, number) };
        case "fail": {
          const problem = typeof p.problem === "string" && p.problem.trim() ? p.problem.trim().slice(0, 500) : "片付けられませんでした。";
          await cleanups.fail(repo, number, problem);
          return { ok: true };
        }
        default:
          throw new PluginError("片付けの指定が正しくありません。");
      }
    },
    /** The session { sessionId } is about to be sent the review of { repo, number }: its end is notified (onSessionStop). */
    async trackReview(params) {
      if (!reviewSessions) throw new PluginError("github-review の daemon の部分が、まだ動き始めていません。");
      const p = objArg(params);
      if (typeof p.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(p.sessionId)) throw new PluginError("セッションの指定が正しくありません。");
      await reviewSessions.track(p.sessionId, repoArg(p.repo), numberArg(p.number));
      return { ok: true };
    },
    /**
     * The session { sessionId } a review is sent to (review-session.ts), by `action`: "track" { repo, number, before? } —
     * remove it once the review is posted; "forget" — not to be removed; "claim" — a page is about to remove it
     * ({ claimed }: false when another page is at it).
     */
    async reviewSession(params) {
      if (!removals) throw new PluginError("github-review の daemon の部分が、まだ動き始めていません。");
      const p = objArg(params);
      if (typeof p.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(p.sessionId)) throw new PluginError("セッションの指定が正しくありません。");
      switch (p.action) {
        case "track": {
          if (p.before !== undefined && (typeof p.before !== "string" || p.before.length > 500)) throw new PluginError("レビューの結果のコメントの指定が正しくありません。");
          await removals.track(p.sessionId, repoArg(p.repo), numberArg(p.number), p.before);
          return { ok: true };
        }
        case "forget":
          await removals.forget(p.sessionId);
          return { ok: true };
        case "claim":
          return { claimed: await removals.claim(p.sessionId) };
        default:
          throw new PluginError("セッションの削除の指定が正しくありません。");
      }
    },
    /**
     * Removes the review worktree of { repo, number } and its local branch, when nothing in it would be lost (Removed);
     * a worktree of any other name only when "マージしてもらう" asked for it to be cleaned up.
     */
    async remove(params, ctx) {
      const { clone, head, onGitHub } = await target(params, ctx);
      const asked = await cleanups?.get(repoArg(objArg(params).repo), head.number);
      return removeWorktree(ctx.exec, clone, head, { anyName: asked?.kind === "merge", onGitHub });
    },
  },
});
