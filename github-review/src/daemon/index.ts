// The daemon part of github-review: on each working server, the repositories that can be watched (from the folders
// Gasho can start sessions in), the pull requests of the review page with where each is here, and making and removing
// the review worktrees with git. gh runs through gasho-daemon (ctx.github); git only in the clones of those folders.
import path from "node:path";
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import { CLEANUP_KINDS, type CleanupKind } from "../cleanup.ts";
import { Cleanups } from "./cleanups.ts";
import { ghError, headArgs, parseHead } from "./gh.ts";
import { createWorktree, removeWorktree, ReviewError, type PrHead } from "./git.ts";
import { Reviewer } from "./reviewer.ts";
import { SessionRemovals } from "./session-removals.ts";

let reviewer: Reviewer | undefined;
let cleanups: Cleanups | undefined;
let removals: SessionRemovals | undefined;

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
  const head: PrHead = { number, branch: pr.branch, fork: pr.fork === true, ...(pr.head ? { head: pr.head } : {}) };
  const clone = await current().cloneOf((args, o) => ctx.github.read(args, o), repo, { pr: head, wait: true });
  if (!clone) throw new ReviewError(`この working server の、Claude Code が信頼しているフォルダーに、${repo} の clone がありません。`);
  return { clone, head, p };
}

export default defineDaemonPlugin({
  start(ctx) {
    cleanups = new Cleanups({ file: path.join(ctx.dataDir, "cleanups.json"), log: ctx.log });
    removals = new SessionRemovals({ file: path.join(ctx.dataDir, "session-removals.json"), log: ctx.log });
    reviewer = new Reviewer({ exec: ctx.exec, folders: ctx.folders, file: path.join(ctx.dataDir, "watched.json"), log: ctx.log, cleanups, removals });
    void reviewer.load();
    void cleanups.load();
    // Listing the folders can take a minute: the first page does not wait for all of it.
    reviewer.repoOptions().catch(() => {});
    void removals.load();
  },
  stop() {
    reviewer = undefined;
    cleanups = undefined;
    removals = undefined;
  },
  methods: {
    /** The repositories that can be watched: RepoOption[]. */
    async options() {
      return current().offered();
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
    /** The primary checkouts watched (string[]), read without gh: the page chooses from them while it has no list. */
    async watched() {
      return current().watching();
    },
    /** Watches { paths } (primary checkouts from `options`) from now on; returns them. */
    async watch(params) {
      return current().watch(objArg(params).paths);
    },
    /** Makes the review worktree of { repo, number }, or finds the one it has (Created). */
    async create(params, ctx) {
      const { clone, head } = await target(params, ctx);
      return createWorktree(ctx.exec, clone, head);
    },
    /**
     * The review worktree of { repo, number } once what was asked of its Agent is done (cleanup.ts), by `action`:
     * "follow" { kind } — remove it once `kind` ("merge" or "sendBack") is done; "forget" — not to be removed (it was,
     * or the person no longer wants it); "claim" — a page is about to remove it ({ claimed }: false when another page
     * is at it, or it failed before); "fail" { problem } — it could not be removed, and why.
     */
    async cleanup(params) {
      if (!cleanups) throw new PluginError("github-review の daemon の部分が、まだ動き始めていません。");
      const p = objArg(params);
      const repo = repoArg(p.repo);
      const number = numberArg(p.number);
      switch (p.action) {
        case "follow": {
          if (!CLEANUP_KINDS.includes(p.kind as CleanupKind)) throw new PluginError("頼んだことの指定が正しくありません。");
          await cleanups.follow(repo, number, p.kind as CleanupKind);
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
     * a worktree of any other name only when "マージしてもらう" asked for it to be cleaned up. Files git does not track go
     * only with { agreed } (the `token` of an answer that listed them); { check: true } only says what would go.
     */
    async remove(params, ctx) {
      const { clone, head, p } = await target(params, ctx);
      const asked = await cleanups?.get(repoArg(p.repo), head.number);
      return removeWorktree(ctx.exec, clone, head, {
        anyName: asked?.kind === "merge",
        ...(typeof p.agreed === "string" ? { agreed: p.agreed } : {}),
        ...(p.check === true ? { check: true } : {}),
      });
    },
  },
});
