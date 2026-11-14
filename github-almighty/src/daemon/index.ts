// The daemon part of github-almighty: a worktree's issues and pull requests, one of them in full, and the changes the
// screen asks for (assign, labels, title and body, comments, close and reopen, draft and ready), all with gh through
// gasho-daemon (ctx.github). The worktrees Gasho showed in the last day are read again in the background, every
// "refreshSeconds" (a setting), so that their tabs and screens open with what GitHub has now.
import path from "node:path";
import { defineDaemonPlugin, PluginError, type DaemonContext, type DaemonStartContext } from "@gasho/plugin-sdk/daemon";
import type { GitHubItemDetail, RepoMeta, WorktreeItems } from "../types.ts";
import {
  assignableArgs,
  branchArg,
  branchNumber,
  commentArgs,
  detailArgs,
  editArgs,
  ghError,
  itemsQueryArgs,
  kindArg,
  labelsArg,
  labelsArgs,
  loginsArg,
  meArgs,
  numberArg,
  parseDetail,
  parseItems,
  parseMeta,
  readyArgs,
  repoArg,
  stateArgs,
  textArg,
} from "./gh.ts";
import { Store } from "./store.ts";

/** The worktrees read in the background: those Gasho showed in the last day. */
const SHOWN_WITHIN_MS = 24 * 60 * 60_000;
const DEFAULT_REFRESH_SECONDS = 60;
/** gasho-daemon keeps a read for 600 seconds at most. */
const KEEP_MAX_SECONDS = 600;

type Ctx = Pick<DaemonContext, "github" | "log">;

let store: Store | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
// start() gets the settings as they were when the process started; every call brings them as they are now.
let settings: Record<string, unknown> = {};

function refreshSeconds(): number {
  const v = settings.refreshSeconds;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_REFRESH_SECONDS;
}

/** How old a kept answer may be: about the refresh interval, so that the background reads and the screen's share gh. */
function keepSeconds(): number {
  const s = refreshSeconds();
  return s === 0 ? 30 : Math.min(KEEP_MAX_SECONDS, Math.max(5, s - 5));
}

function current(): Store {
  if (!store) throw new PluginError("github-almighty の daemon の部分が、まだ動き始めていません。");
  return store;
}

const obj = (params: unknown): Record<string, unknown> => (typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {});

/** The worktree's top folder: used only as the key of what is kept for it, never as a path to read. */
function worktreeArg(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/") || v.length > 1000) throw new PluginError("worktree の指定が正しくありません。");
  return v;
}

/** Runs gh, and turns its failure into a message for the screen. */
async function gh<T>(what: string, run: () => Promise<T>, ctx: Ctx): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if ((e as { gashoPluginError?: unknown })?.gashoPluginError === true) throw e;
    ctx.log(`gh could not ${what}`, e);
    throw new PluginError(ghError(e));
  }
}

/** Numbers GitHub did not have, per owner/name#number: left out of the query for a while, as gh fails on them unkept. */
const missingUntil = new Map<string, number>();
const MISSING_FOR_MS = 10 * 60_000;

async function readItems(ctx: Ctx, repo: string, branch: string | undefined, added: number[], maxAgeSeconds: number): Promise<WorktreeItems> {
  const now = Date.now();
  const gone = (n: number) => (missingUntil.get(`${repo}#${n}`) ?? 0) > now;
  const branchNamed = branchNumber(branch);
  const named = branchNamed !== undefined && !gone(branchNamed) ? branchNamed : undefined;
  const asked = added.filter((n) => !gone(n));
  const args = itemsQueryArgs(repo, branch, [...(named ? [named] : []), ...asked]);
  let stdout: string;
  try {
    stdout = (await ctx.github.read(args, { repo, maxAgeSeconds })).stdout;
  } catch (e) {
    // A number GitHub does not have makes gh fail, with the rest of the answer on stdout.
    const out = (e as { stdout?: unknown })?.stdout;
    if (typeof out !== "string" || !out.includes('"NOT_FOUND"') || !out.includes('"data"')) throw e;
    stdout = out;
  }
  const items = parseItems(stdout, named, asked, now);
  if (named !== undefined && !items.named) missingUntil.set(`${repo}#${named}`, now + MISSING_FOR_MS);
  for (const n of items.missing) missingUntil.set(`${repo}#${n}`, now + MISSING_FOR_MS);
  return { ...items, missing: added.filter((n) => !items.added.some((i) => i.number === n)) };
}

async function readDetail(ctx: Ctx, repo: string, kind: "issues" | "pulls", number: number, maxAgeSeconds: number): Promise<GitHubItemDetail> {
  const { stdout } = await ctx.github.read(detailArgs(repo, kind, number), { repo, maxAgeSeconds, maxBuffer: 32 * 1024 * 1024 });
  const item = parseDetail(stdout, kind);
  if (!item) throw new PluginError("この番号の Issue や Pull request は見つかりません。");
  return item;
}

/** Reads again the worktrees shown in the last day, one after another, then waits for the next round. */
async function round(ctx: DaemonStartContext): Promise<void> {
  const s = current();
  await s.load();
  const keep = keepSeconds();
  for (const [, w] of s.shownSince(Date.now() - SHOWN_WITHIN_MS)) {
    if (stopped) return;
    try {
      const items = await readItems(ctx, w.repo, w.branch, w.added, keep);
      // What a tab opens first: the issue the branch is named after and its open pull requests.
      const open = [...(items.named ? [items.named] : []), ...items.pulls].filter((i) => i.state === "open");
      const seen = new Set<string>();
      for (const i of open) {
        if (stopped || seen.has(`${i.kind}${i.number}`)) continue;
        seen.add(`${i.kind}${i.number}`);
        await readDetail(ctx, w.repo, i.kind, i.number, keep);
      }
    } catch (e) {
      ctx.log(`could not read ${w.repo}${w.branch ? ` (${w.branch})` : ""} again`, e);
    }
  }
}

function schedule(ctx: DaemonStartContext): void {
  if (stopped) return;
  const seconds = refreshSeconds();
  // 0 turns the background reads off; the interval is checked again in a minute.
  timer = setTimeout(
    () => {
      void (seconds === 0 ? Promise.resolve() : round(ctx)).finally(() => schedule(ctx));
    },
    (seconds === 0 ? 60 : seconds) * 1000,
  );
}

export default defineDaemonPlugin({
  start(ctx) {
    stopped = false;
    settings = ctx.settings;
    store = new Store(path.join(ctx.dataDir, "worktrees.json"));
    void store.load();
    schedule(ctx);
  },
  stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    store = undefined;
  },
  methods: {
    /** What the background reads: the worktrees shown in the last day, and the interval → { worktrees, refreshSeconds }. */
    async status(_params, ctx) {
      settings = ctx.settings;
      const s = current();
      await s.load();
      return { worktrees: s.shownSince(Date.now() - SHOWN_WITHIN_MS).length, refreshSeconds: refreshSeconds() };
    },
    /** A worktree's issues and pull requests: { repo, branch?, worktree } → WorktreeItems. */
    async items(params, ctx) {
      settings = ctx.settings;
      const p = obj(params);
      const repo = repoArg(p.repo);
      const branch = branchArg(p.branch);
      const kept = await current().seen(worktreeArg(p.worktree), repo, branch, Date.now());
      return gh("read the items of a worktree", () => readItems(ctx, repo, branch, kept.added, p.fresh === true ? 0 : keepSeconds()), ctx);
    },
    /** One issue or pull request with its conversation: { repo, kind, number, fresh? } → GitHubItemDetail. */
    async item(params, ctx) {
      settings = ctx.settings;
      const p = obj(params);
      const repo = repoArg(p.repo);
      const kind = kindArg(p.kind);
      const number = numberArg(p.number);
      return gh(`read ${kind} #${number}`, () => readDetail(ctx, repo, kind, number, p.fresh === true ? 0 : keepSeconds()), ctx);
    },
    /** The repository's labels and the people who can be assigned: { repo } → RepoMeta. */
    async meta(params, ctx) {
      const repo = repoArg(obj(params).repo);
      return gh(
        "read labels and assignees",
        async (): Promise<RepoMeta> => {
          const [labels, assignable, me] = await Promise.all([
            ctx.github.read(labelsArgs(repo), { maxAgeSeconds: KEEP_MAX_SECONDS }),
            ctx.github.read(assignableArgs(repo), { maxAgeSeconds: KEEP_MAX_SECONDS }),
            ctx.github.read(meArgs, { maxAgeSeconds: KEEP_MAX_SECONDS }).catch(() => undefined),
          ]);
          return parseMeta(labels.stdout, assignable.stdout, me?.stdout);
        },
        ctx,
      );
    },
    /** Adds an issue or pull request to a worktree by hand: { repo, worktree, number }. */
    async add(params, ctx) {
      const p = obj(params);
      const repo = repoArg(p.repo);
      const worktree = worktreeArg(p.worktree);
      const number = numberArg(p.number);
      // It may have been made since GitHub last said it was not there.
      missingUntil.delete(`${repo}#${number}`);
      const items = await gh(`read #${number}`, () => readItems(ctx, repo, undefined, [number], 0), ctx);
      if (items.missing.includes(number)) throw new PluginError(`${repo} に #${number} はありません。`);
      await current().add(worktree, repo, number, Date.now());
      return { ok: true };
    },
    /** Takes a number added by hand off a worktree: { worktree, number }. */
    async remove(params) {
      const p = obj(params);
      await current().remove(worktreeArg(p.worktree), numberArg(p.number));
      return { ok: true };
    },
    /** Title, body, assignees and labels: { repo, kind, number, title?, body?, addAssignees?, removeAssignees?, addLabels?, removeLabels? }. */
    async edit(params, ctx) {
      const p = obj(params);
      const repo = repoArg(p.repo);
      const kind = kindArg(p.kind);
      const number = numberArg(p.number);
      const title = p.title === undefined ? undefined : textArg(p.title, "題", 256);
      if (title !== undefined && !title.trim()) throw new PluginError("題を空にはできません。");
      const change = {
        ...(title !== undefined ? { title } : {}),
        ...(p.body !== undefined ? { body: textArg(p.body, "本文", 65_536) } : {}),
        addAssignees: loginsArg(p.addAssignees),
        removeAssignees: loginsArg(p.removeAssignees),
        addLabels: labelsArg(p.addLabels),
        removeLabels: labelsArg(p.removeLabels),
      };
      await gh(`edit ${kind} #${number}`, () => ctx.github.write(editArgs(repo, kind, number, change), { repo }), ctx);
      return { ok: true };
    },
    /** A comment: { repo, kind, number, body }. */
    async comment(params, ctx) {
      const p = obj(params);
      const repo = repoArg(p.repo);
      const kind = kindArg(p.kind);
      const number = numberArg(p.number);
      const body = textArg(p.body, "コメント", 65_536);
      if (!body.trim()) throw new PluginError("コメントが空です。");
      await gh(`comment on ${kind} #${number}`, () => ctx.github.write(commentArgs(repo, kind, number, body), { repo }), ctx);
      return { ok: true };
    },
    /** Close or reopen: { repo, kind, number, action: "close" | "reopen", reason?: "completed" | "not_planned" }. */
    async state(params, ctx) {
      const p = obj(params);
      const repo = repoArg(p.repo);
      const kind = kindArg(p.kind);
      const number = numberArg(p.number);
      if (p.action !== "close" && p.action !== "reopen") throw new PluginError("閉じるか開き直すかの指定が正しくありません。");
      if (p.reason !== undefined && p.reason !== "completed" && p.reason !== "not_planned") throw new PluginError("閉じる理由の指定が正しくありません。");
      const action = p.action;
      const reason = p.reason as "completed" | "not_planned" | undefined;
      await gh(`${action} ${kind} #${number}`, () => ctx.github.write(stateArgs(repo, kind, number, action, reason), { repo }), ctx);
      return { ok: true };
    },
    /** A pull request ready for review (ready: true), or back to a draft (ready: false): { repo, number, ready }. */
    async ready(params, ctx) {
      const p = obj(params);
      const repo = repoArg(p.repo);
      const number = numberArg(p.number);
      if (typeof p.ready !== "boolean") throw new PluginError("Draft にするかの指定が正しくありません。");
      const ready = p.ready;
      await gh(`mark #${number} ${ready ? "ready" : "draft"}`, () => ctx.github.write(readyArgs(repo, number, ready), { repo }), ctx);
      return { ok: true };
    },
  },
});
