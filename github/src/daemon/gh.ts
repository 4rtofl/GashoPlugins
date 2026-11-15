// What the reads of the GitHub plugin share about gh: the checks of what comes from the browser, the helpers that read
// gh's JSON, and the message for a failure. gasho-daemon runs gh for every plugin (ctx.github.read, plugin API 1.3),
// with the login of whoever runs it, and answers a read from what it kept when the same arguments were read recently.
// Everything here only builds arguments and reads output, so that it can be tested without gh.
import { PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import type { GitHubRepo, MissingScope } from "../types.ts";

export type Gh = Pick<DaemonContext, "github">;

// ---- what comes from the browser ----

export const objArg = (params: unknown): Record<string, unknown> => (typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {});

/**
 * owner/name of the session's repository, checked before it reaches gh: a login (letters, digits and hyphens, not
 * starting with one) and a repository name (letters, digits, ".", "_" and "-", not starting with "-").
 */
export function repoOf(github: GitHubRepo): string {
  const { owner, name } = github;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/.test(name) || name === "." || name === "..") {
    throw new PluginError("このリポジトリの名前は GitHub のものとして読めません。");
  }
  return `${owner}/${name}`;
}

/** A positive integer id or number (a run's, a project's), from a number or its digits. */
export function idArg(v: unknown, what: string): number {
  const n = typeof v === "string" && /^\d{1,16}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw new PluginError(`${what}が正しくありません。`);
  return n;
}

/** A branch name as git allows it (roughly), or undefined for none. */
export function branchArg(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > 250 || v.startsWith("-") || /[\s~^:?*[\\\0]|\.\.|@\{/.test(v)) {
    throw new PluginError("ブランチの指定が正しくありません。");
  }
  return v;
}

/** "Read again now" from the reload button: gh runs again rather than answering from what gasho-daemon kept. */
export const maxAge = (p: Record<string, unknown>, seconds: number): number => (p.fresh ? 0 : seconds);

// ---- reading gh's output ----

export const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Links shown in browsers: pages on github.com only. */
export const githubUrl = (v: unknown): string | undefined => {
  const s = str(v);
  return s?.startsWith("https://github.com/") ? s : undefined;
};

/** What `gh api` printed: JSON (also when it failed with an HTTP error, which it prints on stdout). */
export function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

// ---- failures ----

const SCOPE_COMMAND = (scope: string) => `gh auth refresh -h github.com -s ${scope}`;

/** The scope a failed read lacks, when it says so. */
export function missingScope(e: unknown): MissingScope | undefined {
  const text = errorText(e);
  for (const scope of ["read:project", "read:packages"] as const) {
    // GraphQL: "… requires one of the following scopes: ['read:project'] …"; REST: "You need at least read:packages scope …".
    if (text.includes(`'${scope}'`) || new RegExp(`need at least ${scope}|${scope} scope`, "i").test(text)) return { scope, command: SCOPE_COMMAND(scope) };
  }
  return undefined;
}

function errorText(e: unknown): string {
  const err = (e ?? {}) as { stderr?: unknown; stdout?: unknown; message?: unknown };
  return [err.stderr, err.stdout, err.message].filter((t): t is string => typeof t === "string").join("\n");
}

/** Why a `gh` call failed, for the person looking at the panel. */
export function ghError(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; killed?: unknown };
  if (err.code === "ENOENT") {
    return "この working server に GitHub CLI（gh）がありません。gh を入れて、gh auth login でログインしてください。";
  }
  if (err.killed === true) return "GitHub からの応答が遅く、読み込めませんでした。";
  const text = errorText(e);
  const scope = missingScope(e);
  if (scope) return `gh のログインに ${scope.scope} の権限がありません。working server で ${scope.command} を実行してください。`;
  if (/gh auth login|not logged in|authentication required|Bad credentials/i.test(text)) {
    return "この working server の GitHub CLI（gh）がログインしていません。working server で gh auth login を実行してください。";
  }
  if (/Could not resolve to a Repository|HTTP 404|not found/i.test(text)) {
    return "GitHub で読めませんでした。gh でログインしているアカウントに権限がないか、見つかりません。";
  }
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("Command failed") && !l.startsWith("{"));
  return `GitHub から読み込めませんでした：${(first ?? "原因が分かりません").slice(0, 200)}`;
}
