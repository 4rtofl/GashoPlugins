// The daemon part of github-review: on each working server, the repositories that can be watched (from the folders
// Gasho can start sessions in), the pull requests of the review page with where each is here, and making and removing
// the review worktrees with git. gh runs through gasho-daemon (ctx.github); git only in the clones of those folders.
import path from "node:path";
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import { ghError, headArgs, parseHead } from "./gh.ts";
import { createWorktree, removeWorktree, ReviewError, type PrHead } from "./git.ts";
import { Reviewer } from "./reviewer.ts";

let reviewer: Reviewer | undefined;

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
  const clone = await current().cloneOf(repo);
  if (!clone) throw new ReviewError(`この working server の、Claude Code が信頼しているフォルダーに、${repo} の clone がありません。`);
  const head: PrHead = { number, branch: pr.branch, fork: pr.fork === true, ...(pr.head ? { head: pr.head } : {}) };
  return { clone, head };
}

export default defineDaemonPlugin({
  start(ctx) {
    reviewer = new Reviewer({ exec: ctx.exec, folders: ctx.folders, file: path.join(ctx.dataDir, "watched.json"), log: ctx.log });
    void reviewer.load();
  },
  stop() {
    reviewer = undefined;
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
    /** Watches { paths } (primary checkouts from `options`) from now on; returns them. */
    async watch(params) {
      return current().watch(objArg(params).paths);
    },
    /** Makes the review worktree of { repo, number }, or finds the one it has (Created). */
    async create(params, ctx) {
      const { clone, head } = await target(params, ctx);
      return createWorktree(ctx.exec, clone, head);
    },
    /** Removes the review worktree of { repo, number } and its local branch, when nothing in it would be lost (Removed). */
    async remove(params, ctx) {
      const { clone, head } = await target(params, ctx);
      return removeWorktree(ctx.exec, clone, head);
    },
  },
});
