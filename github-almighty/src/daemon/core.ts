// What the operations of the daemon part share: the worktrees kept on the working server, the settings as the last
// call brought them, gh with its failures turned into messages, and the reads of a worktree's items and of one item,
// which the background reads use too.
import path from "node:path";
import { PluginError, type DaemonContext, type GitHubReadOptions } from "@gasho/plugin-sdk/daemon";
import type { GitHubItemDetail, GitHubKind, WorktreeItems } from "../types.ts";
import { branchNumber, detailArgs, ghError, itemsQueryArgs, parseDetail, parseItems, type DetailPart } from "./gh.ts";
import { Store } from "./store.ts";

/** The worktrees read in the background: those Gasho showed in the last day. */
export const SHOWN_WITHIN_MS = 24 * 60 * 60_000;
const DEFAULT_REFRESH_SECONDS = 60;
/** gasho-daemon keeps a read for 600 seconds at most. */
export const KEEP_MAX_SECONDS = 600;

export type Ctx = Pick<DaemonContext, "github" | "log">;

let store: Store | undefined;
// start() gets the settings as they were when the process started; every call brings them as they are now.
let settings: Record<string, unknown> = {};
const detailParts: DetailPart[] = [];

export function begin(dataDir: string, startSettings: Record<string, unknown>): void {
  settings = startSettings;
  store = new Store(path.join(dataDir, "worktrees.json"));
  void store.load();
}

export function end(): void {
  store = undefined;
}

export function takeSettings(now: Record<string, unknown>): void {
  settings = now;
}

/** The parts of detail/, which index.ts finds. */
export function addDetailParts(parts: DetailPart[]): void {
  detailParts.push(...parts);
}

export function refreshSeconds(): number {
  const v = settings.refreshSeconds;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_REFRESH_SECONDS;
}

/** How old a kept answer may be: about the refresh interval, so that the background reads and the screen's share gh. */
export function keepSeconds(): number {
  const s = refreshSeconds();
  return s === 0 ? 30 : Math.min(KEEP_MAX_SECONDS, Math.max(5, s - 5));
}

/** How old a read may be for a call: none when the screen asks for a fresh one (its reload button). */
export const maxAge = (params: Record<string, unknown>): number => (params.fresh === true ? 0 : keepSeconds());

export function current(): Store {
  if (!store) throw new PluginError("github-almighty の daemon の部分が、まだ動き始めていません。");
  return store;
}

/** Runs gh, and turns its failure into a message for the screen. */
export async function gh<T>(what: string, run: () => Promise<T>, ctx: Ctx): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if ((e as { gashoPluginError?: unknown })?.gashoPluginError === true) throw e;
    ctx.log(`gh could not ${what}`, e);
    throw new PluginError(ghError(e));
  }
}

/**
 * The output of a GraphQL read, also when a part of it is something GitHub does not have (a number, a branch): gh
 * fails then, with the rest of the answer on stdout.
 */
export async function readAllowingNotFound(ctx: Ctx, args: string[], options: GitHubReadOptions): Promise<string> {
  try {
    return (await ctx.github.read(args, options)).stdout;
  } catch (e) {
    const out = (e as { stdout?: unknown })?.stdout;
    if (typeof out !== "string" || !out.includes('"NOT_FOUND"') || !out.includes('"data"')) throw e;
    return out;
  }
}

/** Numbers GitHub did not have, per owner/name#number: left out of the query for a while, as gh fails on them unkept. */
const missingUntil = new Map<string, number>();
const MISSING_FOR_MS = 10 * 60_000;

/** It may have been made since GitHub last said it was not there. */
export function forgetMissing(repo: string, number: number): void {
  missingUntil.delete(`${repo}#${number}`);
}

export async function readItems(ctx: Ctx, repo: string, branch: string | undefined, added: number[], maxAgeSeconds: number): Promise<WorktreeItems> {
  const now = Date.now();
  const gone = (n: number) => (missingUntil.get(`${repo}#${n}`) ?? 0) > now;
  const branchNamed = branchNumber(branch);
  const named = branchNamed !== undefined && !gone(branchNamed) ? branchNamed : undefined;
  const asked = added.filter((n) => !gone(n));
  const stdout = await readAllowingNotFound(ctx, itemsQueryArgs(repo, branch, [...(named ? [named] : []), ...asked]), { repo, maxAgeSeconds });
  const items = parseItems(stdout, named, asked, now);
  if (named !== undefined && !items.named) missingUntil.set(`${repo}#${named}`, now + MISSING_FOR_MS);
  for (const n of items.missing) missingUntil.set(`${repo}#${n}`, now + MISSING_FOR_MS);
  return { ...items, missing: added.filter((n) => !items.added.some((i) => i.number === n)) };
}

export async function readDetail(ctx: Ctx, repo: string, kind: GitHubKind, number: number, maxAgeSeconds: number): Promise<GitHubItemDetail> {
  const { stdout } = await ctx.github.read(detailArgs(repo, kind, number, detailParts), { repo, maxAgeSeconds, maxBuffer: 32 * 1024 * 1024 });
  const item = parseDetail(stdout, kind, detailParts);
  if (!item) throw new PluginError("この番号の Issue や Pull request は見つかりません。");
  return item;
}
