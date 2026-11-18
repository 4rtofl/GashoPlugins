// The Actions panels: the repository's runs, filtered by workflow and branch (the session's branch one press away),
// and one run with its jobs, steps and the end of a failed job's log, at its latest attempt or an earlier one. While a
// run shown is going, both read again by themselves. Back from a run, the list is where it was scrolled to.
import { ArrowLeft, ChevronRight, GitBranch } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn, relativeTime, useNavigation, useNow, type PanelProps, type Params } from "@gasho/plugin-sdk";
import type { Job, Run, RunDetail, Runs } from "../types.ts";
import { duration, Empty, isRunning, LoadedAt, PanelFrame, PanelRepoTabs, RUN_STATE, RunStateIcon, Status, usePanelRepo, useRead } from "./common";

/** How often a panel reads again while a run it shows is going (seconds). */
const LIVE_SECONDS = 15;

/** Where each list (of a session, with its filters) was scrolled to when a run was opened from it. */
const SCROLLED = new Map<string, number>();

/** The element that scrolls the panel's content. */
function scroller(el: HTMLElement | null): HTMLElement | undefined {
  for (let p = el?.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  return undefined;
}

/** A run's workflow, also when GitHub could not read the name in its file. */
const workflowName = (run: Run): string => run.workflow || "ワークフロー";

const EVENT: Record<string, string> = {
  push: "push",
  pull_request: "Pull request",
  pull_request_target: "Pull request",
  workflow_dispatch: "手動",
  schedule: "定期",
  release: "リリース",
  workflow_run: "ほかの実行のあと",
  merge_group: "マージキュー",
};

export function RunsPanel({ machine, session, params }: PanelProps) {
  const nav = useNavigation();
  const now = useNow(10_000);
  const { noRepo, where, github, branch: sessionBranch } = usePanelRepo(session, params);
  const workflow = params.workflow ?? "";
  const branch = params.branch ?? "";
  const filters: Params = { ...where, ...(workflow ? { workflow } : {}), ...(branch ? { branch } : {}) };
  const [live, setLive] = useState(false);
  const r = useRead<Runs>(machine, session, "runs", noRepo ? undefined : filters, live ? { refreshSeconds: LIVE_SECONDS } : undefined);
  const data = r.data;
  const anyRunning = Boolean(data?.runs.some((run) => isRunning(run.state)));
  useEffect(() => setLive(anyRunning), [anyRunning]);
  const setFilter = (next: Params) => nav.replacePanel("actions", { ...filters, ...next });
  // The branches to choose from: the session's, the one chosen, and those of the runs of any branch.
  const branches = [...new Set([sessionBranch, branch, ...(data?.branches ?? [])].filter((b): b is string => Boolean(b)))];
  const href = github ? `${github.url}/actions` : undefined;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollKey = `${machine.id} ${session.sessionId} ${JSON.stringify(filters)}`;
  const restored = useRef<string>(undefined);
  useLayoutEffect(() => {
    if (!data || restored.current === scrollKey) return;
    restored.current = scrollKey;
    const top = SCROLLED.get(scrollKey);
    const box = scroller(listRef.current);
    if (top !== undefined && box) box.scrollTop = top;
  }, [data, scrollKey]);
  return (
    <PanelFrame title="Actions" github={github} cwd={session.cwd} href={href} r={r} disabled={!machine.connected || noRepo}>
      <PanelRepoTabs session={session} params={params} panel="actions" />
      <div ref={listRef} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="ワークフロー"
            value={workflow}
            onChange={(e) => setFilter({ workflow: e.target.value })}
            className="h-7 max-w-full min-w-0 rounded-md border border-border bg-surface px-2 text-foreground"
          >
            <option value="">すべてのワークフロー</option>
            {data?.workflows.map((w) => (
              <option key={w.id} value={String(w.id)}>
                {w.name}
                {w.active ? "" : "（無効）"}
              </option>
            ))}
          </select>
          <select
            aria-label="ブランチ"
            value={branch}
            onChange={(e) => setFilter({ branch: e.target.value })}
            className="h-7 max-w-full min-w-0 rounded-md border border-border bg-surface px-2 font-mono text-foreground"
          >
            <option value="">すべてのブランチ</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {sessionBranch && (
            <button
              type="button"
              aria-pressed={branch === sessionBranch}
              onClick={() => setFilter({ branch: branch === sessionBranch ? "" : sessionBranch })}
              title={`このセッションのブランチ（${sessionBranch}）の実行だけにする`}
              className={cn(
                "inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-md border px-2",
                branch === sessionBranch ? "border-sky-500/50 bg-sky-500/10 text-sky-300" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <GitBranch className="size-3.5 shrink-0" />
              <span className="truncate">このブランチ</span>
            </button>
          )}
        </div>
        <Status machine={machine} noRepo={noRepo} error={r.error} loading={!data && r.loading} />
        {data &&
          (data.runs.length === 0 ? (
            <Empty>{workflow || branch ? "この条件の実行はありません。" : "まだ実行がありません。"}</Empty>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {data.runs.map((run) => {
                const target = { ...where, id: String(run.id), ...(workflow ? { workflow } : {}), ...(branch ? { branch } : {}) };
                return (
                  <li key={run.id}>
                    <a
                      href={nav.panelHref("run", target)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        SCROLLED.set(scrollKey, scroller(listRef.current)?.scrollTop ?? 0);
                        nav.openPanel("run", target);
                      }}
                      className="flex gap-2.5 px-3 py-2.5 hover:bg-surface-raised"
                    >
                      <RunStateIcon state={run.state} className="mt-0.5" />
                      <RunSummary run={run} now={now} />
                    </a>
                  </li>
                );
              })}
            </ul>
          ))}
        {data?.truncated && <p className="text-xs text-muted-foreground">新しいものから {data.runs.length} 件を表示しています。すべては GitHub で見られます。</p>}
        {anyRunning && <p className="text-xs text-muted-foreground">実行中のものがあるあいだ、{LIVE_SECONDS} 秒ごとに読み直します。</p>}
        <LoadedAt at={r.at} />
      </div>
    </PanelFrame>
  );
}

function RunSummary({ run, now }: { run: Run; now: number }) {
  const created = Date.parse(run.createdAt);
  const running = isRunning(run.state);
  // A run waiting for approval, or whose workflow could not start, has not run at all.
  const took = run.state === "action_required" || run.startupFailure ? undefined : duration(run.startedAt ?? run.createdAt, running ? undefined : run.updatedAt, now, running);
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm leading-snug break-words">{run.title || workflowName(run)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <span className="text-foreground/80">
          {workflowName(run)}
          {run.number ? <span className="tabular-nums"> #{run.number}</span> : null}
        </span>
        {run.branch && (
          <span className="max-w-full min-w-0 truncate font-mono" title={run.branch}>
            {run.branch}
          </span>
        )}
        <span>{EVENT[run.event] ?? run.event}</span>
        <span className={cn(run.state === "failure" && "text-red-400", (running || run.state === "action_required") && "text-amber-400")}>
          {run.startupFailure ? "始められなかった" : RUN_STATE[run.state]}
        </span>
        {took && <span className="tabular-nums">{took}</span>}
        {Number.isFinite(created) && <span title={new Date(created).toLocaleString("ja-JP")}>{relativeTime(created, now)}</span>}
        {run.attempt && run.attempt > 1 ? <span>{run.attempt} 回目</span> : null}
      </div>
    </div>
  );
}

/** What a run without jobs says: why there are none. */
function noJobs(run: RunDetail): string {
  if (run.startupFailure) return "ワークフローのファイルに誤りがあり、実行を始められませんでした。理由は GitHub で見られます。";
  if (run.state === "action_required") return "GitHub で承認されると、ジョブが始まります。";
  if (run.state === "cancelled") return "ジョブが始まる前に取り消されました。";
  return isRunning(run.state) ? "ジョブはまだありません。" : "ジョブはありません。";
}

export function RunPanel({ machine, session, params }: PanelProps) {
  const nav = useNavigation();
  const now = useNow(5_000);
  const { where, github } = usePanelRepo(session, params);
  const id = /^\d{1,16}$/.test(params.id ?? "") ? params.id : undefined;
  const attempt = /^\d{1,4}$/.test(params.attempt ?? "") ? params.attempt : undefined;
  const [live, setLive] = useState(false);
  const r = useRead<RunDetail>(machine, session, "run", id ? { ...where, id, ...(attempt ? { attempt } : {}) } : undefined, live ? { refreshSeconds: LIVE_SECONDS } : undefined);
  const run = r.data;
  const going = Boolean(run && isRunning(run.state));
  useEffect(() => setLive(going), [going]);
  const filters: Params = { ...(params.workflow ? { workflow: params.workflow } : {}), ...(params.branch ? { branch: params.branch } : {}) };
  const back: Params = { ...where, ...filters };
  const attempts = run?.attempts ?? run?.attempt ?? 1;
  return (
    <PanelFrame
      title={run ? `${workflowName(run)}${run.number ? ` #${run.number}` : ""}` : "Actions の実行"}
      github={github}
      cwd={session.cwd}
      // gh gives an earlier attempt's url with its /attempts/<n>.
      href={run ? run.url : github && id ? `${github.url}/actions/runs/${id}` : undefined}
      r={r}
      disabled={!machine.connected || !id}
    >
      <button type="button" onClick={() => nav.back({ id: "actions", params: back })} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Actions の一覧
      </button>
      <div className="space-y-4">
        {!id && <p className="text-sm text-red-400">実行の番号が正しくありません。</p>}
        <Status machine={machine} error={r.error} loading={!run && r.loading && Boolean(id)} />
        {run && (
          <>
            <header className="flex gap-2.5">
              <RunStateIcon state={run.state} className="mt-1" />
              <RunSummary run={run} now={now} />
            </header>
            {attempts > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                実行した回
                <select
                  value={String(run.attempt ?? attempts)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    nav.replacePanel("run", { ...where, id: id ?? "", ...(n < attempts ? { attempt: String(n) } : {}), ...filters });
                  }}
                  className="h-7 rounded-md border border-border bg-surface px-2 text-foreground"
                >
                  {Array.from({ length: attempts }, (_, i) => attempts - i).map((n) => (
                    <option key={n} value={String(n)}>
                      {n} 回目{n === attempts ? "（最新）" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {run.jobs.length === 0 ? (
              <Empty>{noJobs(run)}</Empty>
            ) : (
              <ul className="space-y-2">
                {run.jobs.map((job) => (
                  <JobCard key={job.id} job={job} now={now} />
                ))}
              </ul>
            )}
            {going && <p className="text-xs text-muted-foreground">実行が終わるまで、{LIVE_SECONDS} 秒ごとに読み直します。</p>}
          </>
        )}
        <LoadedAt at={r.at} />
      </div>
    </PanelFrame>
  );
}

function JobCard({ job, now }: { job: Job; now: number }) {
  const took = duration(job.startedAt, job.completedAt, now, isRunning(job.state));
  // A failed job opens by itself, with its log.
  return (
    <li>
      <details open={job.state === "failure" || isRunning(job.state)} className="group overflow-hidden rounded-xl border border-border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-surface-raised [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <RunStateIcon state={job.state} />
          <span className="min-w-0 flex-1 truncate text-sm" title={job.name}>
            {job.name}
          </span>
          {took && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{took}</span>}
        </summary>
        <div className="space-y-2 border-t border-border px-3 py-2">
          <ol className="space-y-1 text-xs">
            {job.steps.map((s) => (
              <li key={s.number} className={cn("flex items-center gap-2", s.state === "skipped" && "text-muted-foreground")}>
                <RunStateIcon state={s.state} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate" title={s.name}>
                  {s.name}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{s.state === "skipped" ? "" : (duration(s.startedAt, s.completedAt, now, isRunning(s.state)) ?? "")}</span>
              </li>
            ))}
          </ol>
          {job.log && job.log.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">失敗したステップのログ（末尾 {job.log.length} 行）</p>
              <pre
                // Shown from its end, where the error is.
                ref={(el) => {
                  if (el && el.dataset.scrolled !== "1") {
                    el.scrollTop = el.scrollHeight;
                    el.dataset.scrolled = "1";
                  }
                }}
                className="max-h-96 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre text-neutral-200"
              >
                {job.log.join("\n")}
              </pre>
            </div>
          )}
          {job.logError && <p className="text-xs text-muted-foreground">{job.logError}</p>}
          {job.url && (
            <a href={job.url} target="_blank" rel="noreferrer" className="inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
              GitHub でログ全体を見る
            </a>
          )}
        </div>
      </details>
    </li>
  );
}
