// The GitHub tile of the home screen, from the Git plugin (moved here from Gasho's views/home.tsx): the open issues and pull requests of each
// repository the sessions started from Gasho work in, read with gh on the working server. Each count opens the
// session's panel with the list.
import { CircleDot, FolderGit2, GitPullRequest } from "lucide-react";
import { useMemo } from "react";
import {
  Tile,
  useDaemonReady,
  useMachines,
  useNavigation,
  useRequest,
  type GitHubRepo,
  type MachineInfo,
  type SessionInfo,
} from "@gasho/plugin-sdk";
import type { GitHubList, GitHubListKind } from "../types.ts";

/** Lists on the home screen are read again when older than this. */
const STALE_SECONDS = 5 * 60;
/** Waiting first (they need an answer), then working, then idle; the latest activity first within each. */
const STATUS_ORDER: Record<SessionInfo["status"], number> = { waiting: 0, busy: 1, idle: 2, unknown: 3 };

/** A repository on GitHub that a session works in, with the session (and folder) whose panels show it. */
interface RepoRef {
  github: GitHubRepo;
  machine: MachineInfo;
  sessionId: string;
  repo?: string;
}

export function RepoCounts() {
  const machines = useMachines();
  const repos = useMemo(() => {
    const rows = machines
      .flatMap((machine) => machine.sessions.filter((s) => s.managed).map((s) => ({ machine, s })))
      .sort(
        (a, b) =>
          STATUS_ORDER[a.machine.connected ? a.s.status : "unknown"] - STATUS_ORDER[b.machine.connected ? b.s.status : "unknown"] ||
          (b.s.lastActivityAt ?? 0) - (a.s.lastActivityAt ?? 0),
      );
    const seen = new Map<string, RepoRef>();
    for (const { machine, s } of rows) {
      if (!machine.connected) continue;
      const here: { github: GitHubRepo; repo?: string }[] = s.repos?.length
        ? s.repos.flatMap((r) => (r.github ? [{ github: r.github, repo: r.path }] : []))
        : s.github
          ? [{ github: s.github }]
          : [];
      for (const h of here) {
        const key = `${h.github.owner}/${h.github.name}`.toLowerCase();
        if (!seen.has(key)) seen.set(key, { ...h, machine, sessionId: s.sessionId });
      }
    }
    return [...seen.values()];
  }, [machines]);

  return (
    <Tile title="GitHub" icon={<FolderGit2 className="size-4" />}>
      {repos.length === 0 ? (
        <p className="text-sm text-muted-foreground">GitHub のリポジトリで作業しているセッションはありません。</p>
      ) : (
        <ul className="space-y-3">
          {repos.map((r) => (
            <RepoRow key={`${r.github.owner}/${r.github.name}`} r={r} />
          ))}
        </ul>
      )}
    </Tile>
  );
}

function RepoRow({ r }: { r: RepoRef }) {
  const ready = useDaemonReady(r.machine.id).ready;
  const nav = useNavigation();
  const target = (kind: GitHubListKind) =>
    ready ? { machine: r.machine.id, sessionId: r.sessionId, method: "list", params: { kind, ...(r.repo ? { repo: r.repo } : {}) } } : undefined;
  // Read once, and again when old. A list that failed is not asked again on its own.
  const lists = {
    issues: useRequest<GitHubList>(target("issues"), { staleSeconds: STALE_SECONDS }),
    pulls: useRequest<GitHubList>(target("pulls"), { staleSeconds: STALE_SECONDS }),
  };
  const error = lists.issues.error ?? lists.pulls.error;
  return (
    <li className="min-w-0">
      <p className="truncate text-sm font-medium text-foreground" title={`${r.github.owner}/${r.github.name}`}>
        {r.github.owner}/{r.github.name}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(["issues", "pulls"] as const).map((kind) => {
          const g = lists[kind];
          const n = !ready ? "-" : g.data?.disabled ? "無効" : g.data ? `${g.data.items.length}${g.data.truncated ? "+" : ""}` : g.loading ? "…" : "-";
          return (
            <button
              key={kind}
              type="button"
              onClick={() => nav.openPanel("list", { kind, ...(r.repo ? { repo: r.repo } : {}) }, { machine: r.machine.id, sessionId: r.sessionId })}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              {kind === "issues" ? <CircleDot className="size-3.5" /> : <GitPullRequest className="size-3.5" />}
              {kind === "issues" ? "Issues" : "Pull requests"}
              <span className="tabular-nums text-foreground">{n}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </li>
  );
}
