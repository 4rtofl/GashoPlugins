// What the panels of the GitHub plugin share: the repository a panel is about (tabs in a folder of several), the
// request with a reload that makes gh read again, the header's buttons, the notes for a missing scope or an offline
// working server, and the marks and durations of Actions.
import { Check, CircleCheck, CircleDashed, CircleMinus, CircleSlash, CircleX, Clock, Copy, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  cn,
  Panel,
  PANEL_BUTTON,
  panelRepo,
  RepoTabs,
  useCall,
  useNavigation,
  useRequest,
  type MachineInfo,
  type Params,
  type RequestOptions,
  type SessionInfo,
  type SessionRepo,
} from "@gasho/plugin-sdk";
import type { GitHubRepo, MissingScope, RunState } from "../types.ts";

/** The repository a panel is about: the session's, or (in a folder of several) the one of its tabs. */
export function usePanelRepo(session: SessionInfo, params: Params) {
  const { repos, selected } = panelRepo(session, params.repo, (r: SessionRepo) => Boolean(r.github));
  const where: Params = selected ? { repo: selected.path } : {};
  const github: GitHubRepo | undefined = selected ? selected.github : session.github;
  // A session in a repository may also list none inside it (repos: []): what counts is the repository found.
  const noRepo = !github;
  const branch = selected ? selected.branch : session.gitBranch;
  return { repos, selected, noRepo, where, github, branch };
}

/** The repositories' tabs, when the session's folder holds two or more on GitHub. */
export function PanelRepoTabs({ session, params, panel }: { session: SessionInfo; params: Params; panel: string }) {
  const nav = useNavigation();
  const { repos, selected } = usePanelRepo(session, params);
  if (!repos || repos.length < 2 || !selected) return null;
  return <RepoTabs repos={repos} selected={selected.path} onSelect={(path) => nav.replacePanel(panel, { repo: path })} />;
}

/**
 * A read of the daemon part. `refresh` (the reload button) asks with `fresh`, so that gh reads GitHub again rather than
 * gasho-daemon answering from what it kept, then reads the request again (now answered with that).
 */
export function useRead<T>(machine: MachineInfo, session: SessionInfo, method: string, params: Record<string, unknown> | undefined, options?: RequestOptions) {
  const r = useRequest<T>(
    machine.connected && params ? { machine: machine.id, sessionId: session.sessionId, method, params } : undefined,
    { staleSeconds: 0, ...options },
  );
  const call = useCall();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (!params) return;
    setRefreshing(true);
    try {
      await call({ machine: machine.id, sessionId: session.sessionId, method, params: { ...params, fresh: true } });
    } finally {
      setRefreshing(false);
      r.reload();
    }
  };
  return { ...r, loading: r.loading || refreshing, refresh };
}

/** The panel header's buttons: open on GitHub, and read again. */
export function HeaderActions({ href, onReload, loading, disabled }: { href?: string; onReload: () => void; loading: boolean; disabled: boolean }) {
  return (
    <>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className={PANEL_BUTTON}>
          GitHub <ExternalLink className="size-3.5" />
        </a>
      )}
      <button type="button" onClick={onReload} disabled={loading || disabled} aria-label="再読み込み" title="再読み込み" className={PANEL_BUTTON}>
        <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
      </button>
    </>
  );
}

/** Why there is nothing to show yet: no repository, offline, an error, loading. */
export function Status({ machine, noRepo, error, loading }: { machine: MachineInfo; noRepo?: boolean; error?: string; loading: boolean }) {
  return (
    <>
      {noRepo && <p className="text-sm text-muted-foreground">このセッションのフォルダーには、GitHub のリポジトリがありません。</p>}
      {!machine.connected && <p className="text-sm text-muted-foreground">{machine.name} はオフラインです。</p>}
      {error && <p className="text-sm break-words text-red-400">{error}</p>}
      {loading && !noRepo && machine.connected && <p className="text-sm text-muted-foreground">読み込み中…</p>}
    </>
  );
}

/** A command to copy: what adds a scope, or what installs a package. */
export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
      <code className="min-w-0 flex-1 font-mono text-xs break-all text-foreground/90">{command}</code>
      <button
        type="button"
        aria-label="コピー"
        title="コピー"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

/** gh's login lacks a scope: what it is for, and the command that adds it. */
export function MissingScopeNote({ missing, what, machine }: { missing: MissingScope; what: string; machine: MachineInfo }) {
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
      <p>
        {what}を読むには、{machine.name} の gh のログインに <code className="font-mono">{missing.scope}</code> の権限が要ります。{machine.name} で次のコマンドを実行し、ブラウザーで許可してから読み直してください。
      </p>
      <CommandLine command={missing.command} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function LoadedAt({ at }: { at?: number }) {
  return at ? <p className="text-xs text-muted-foreground">{new Date(at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} に読み込み</p> : null;
}

// ---- Actions ----

export const RUN_STATE: Record<RunState, string> = {
  success: "成功",
  failure: "失敗",
  cancelled: "取り消し",
  skipped: "スキップ",
  neutral: "完了",
  in_progress: "実行中",
  queued: "待ち",
  waiting: "承認待ち",
};

export function RunStateIcon({ state, className }: { state: RunState; className?: string }) {
  const label = RUN_STATE[state];
  const c = cn("size-4 shrink-0", className);
  switch (state) {
    case "success":
      return <CircleCheck aria-label={label} className={cn(c, "text-emerald-400")} />;
    case "failure":
      return <CircleX aria-label={label} className={cn(c, "text-red-400")} />;
    case "cancelled":
      return <CircleSlash aria-label={label} className={cn(c, "text-muted-foreground")} />;
    case "skipped":
    case "neutral":
      return <CircleMinus aria-label={label} className={cn(c, "text-muted-foreground")} />;
    case "in_progress":
      return <LoaderCircle aria-label={label} className={cn(c, "animate-spin text-amber-400")} />;
    case "waiting":
      return <Clock aria-label={label} className={cn(c, "text-amber-400")} />;
    default:
      return <CircleDashed aria-label={label} className={cn(c, "text-amber-400")} />;
  }
}

export const isRunning = (state: RunState): boolean => state === "in_progress" || state === "queued" || state === "waiting";

/** "1分23秒", "45秒", "2時間5分": from `from` to `to` (or now while it runs). */
export function duration(from: string | undefined, to: string | undefined, now: number): string | undefined {
  const a = Date.parse(from ?? "");
  const b = to ? Date.parse(to) : now;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60 ? `${s % 60}秒` : ""}`;
  return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`;
}

/** The frame of the plugin's panels: title, the repository, and the header's buttons. */
export function PanelFrame({
  title,
  github,
  cwd,
  href,
  r,
  disabled,
  children,
}: {
  title: string;
  github?: { owner: string; name: string };
  cwd: string;
  href?: string;
  r: { loading: boolean; refresh: () => void };
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Panel title={title} subtitle={github ? `${github.owner}/${github.name}` : cwd} actions={<HeaderActions href={href} onReload={() => void r.refresh()} loading={r.loading} disabled={disabled} />}>
      {children}
    </Panel>
  );
}
