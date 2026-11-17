// What the operations of the daemon part share: the worktrees kept on the working server, the settings as the last
// call brought them, gh with its failures turned into messages, and the reads of a worktree's items and of one item,
// which the background reads use too. A read of one item uses what gasho-daemon kept as long as the item's version
// (what the read of its worktree's items says of it) is the same, up to KEEP_MAX_SECONDS.
import path from "node:path";
import { PluginError, type DaemonContext, type ExecResult, type GitHubReadOptions } from "@gasho/plugin-sdk/daemon";
import type { GitHubItemDetail, GitHubKind, WorktreeItems } from "../types.ts";
import { branchNumber, detailArgs, ghError, itemsQueryArgs, itemVersions, parseDetail, parseItems, type DetailPart } from "./gh.ts";
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
  if (!store) throw new PluginError("github-implement の daemon の部分が、まだ動き始めていません。");
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
export async function readAllowingNotFound(answer: Promise<ExecResult>): Promise<string> {
  try {
    return (await answer).stdout;
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

/** What the last read of a worktree's items said of one of its issues and pull requests. */
interface Version {
  value: string;
  /** When this value was first read: what gasho-daemon kept from before it may not have what changed it. */
  since: number;
  /** When it was last read, and the worktree's items it was read with, to read it again. */
  at: number;
  branch: string | undefined;
  added: number[];
}

/** By versionKey. */
const versions = new Map<string, Version>();
const versionKey = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;

export async function readItems(ctx: Ctx, repo: string, branch: string | undefined, added: number[], maxAgeSeconds: number): Promise<WorktreeItems> {
  const now = Date.now();
  const gone = (n: number) => (missingUntil.get(`${repo}#${n}`) ?? 0) > now;
  const branchNamed = branchNumber(branch);
  const named = branchNamed !== undefined && !gone(branchNamed) ? branchNamed : undefined;
  const asked = added.filter((n) => !gone(n));
  const stdout = await readAllowingNotFound(ctx.github.read(itemsQueryArgs(repo, branch, [...(named ? [named] : []), ...asked]), { repo, maxAgeSeconds }));
  const items = parseItems(stdout, named, asked, now);
  if (named !== undefined && !items.named) missingUntil.set(`${repo}#${named}`, now + MISSING_FOR_MS);
  for (const n of items.missing) missingUntil.set(`${repo}#${n}`, now + MISSING_FOR_MS);
  const at = Date.now();
  for (const [n, value] of itemVersions(stdout)) {
    const was = versions.get(versionKey(repo, n));
    if (was?.value === value) Object.assign(was, { at, branch, added });
    else versions.set(versionKey(repo, n), { value, since: at, at, branch, added });
  }
  return { ...items, missing: added.filter((n) => !items.added.some((i) => i.number === n)) };
}

/**
 * The item's version, read again with its worktree's items when it was read more than keepSeconds ago: the tabs read
 * the same, so gh runs only when gasho-daemon's answer is that old too.
 */
async function versionOf(ctx: Ctx, repo: string, number: number): Promise<Version | undefined> {
  const v = versions.get(versionKey(repo, number));
  if (v && Date.now() - v.at > keepSeconds() * 1000) {
    try {
      await readItems(ctx, repo, v.branch, v.added, keepSeconds());
    } catch (e) {
      ctx.log(`could not read the version of ${repo}#${number}`, e);
    }
  }
  return versions.get(versionKey(repo, number));
}

export type ItemRead = (args: string[], options?: GitHubReadOptions) => Promise<ExecResult>;

/**
 * ctx.github.read for the reads of one issue or pull request (its body, comments, files, …). While its version is the
 * same, they use what gasho-daemon kept since the version was first read, up to KEEP_MAX_SECONDS: changes GitHub does
 * not show in it (reactions, project values) show within that. Without a version of now (it is in no worktree's tabs),
 * keepSeconds as other reads; nothing kept when the screen asks for a fresh one; a maxAgeSeconds given still applies.
 */
export function itemRead(ctx: Ctx, repo: string, number: number, params: Record<string, unknown> = {}): ItemRead {
  return async (args, options = {}) => {
    const v = await versionOf(ctx, repo, number);
    const known = v && Date.now() - v.at <= keepSeconds() * 1000 ? v : undefined;
    // Not rounded to seconds: the screen reads in the same second as the version, and what it read then is good.
    const maxAgeSeconds = params.fresh === true ? 0 : known ? Math.min(KEEP_MAX_SECONDS, (Date.now() - known.since) / 1000) : keepSeconds();
    const answer = await ctx.github.read(args, { repo, maxAgeSeconds, ...options });
    // A version read while gh ran may be of a change gh read GitHub before: what was kept up to now is too old for it.
    const after = versions.get(versionKey(repo, number));
    if (after && after !== v) after.since = Date.now();
    return answer;
  };
}

export async function readDetail(ctx: Ctx, repo: string, kind: GitHubKind, number: number, params: Record<string, unknown> = {}): Promise<GitHubItemDetail> {
  const { stdout } = await itemRead(ctx, repo, number, params)(detailArgs(repo, kind, number, detailParts), { maxBuffer: 32 * 1024 * 1024 });
  const item = parseDetail(stdout, kind, detailParts);
  if (!item) throw new PluginError("この番号の Issue や Pull request は見つかりません。");
  return item;
}
