// The checks of a pull request's latest commit: how many failed, run and passed, and each with a link to its details.
// A failed job of GitHub Actions opens to the end of its log, and its run's failed jobs can be run again; the other
// checks have their details on GitHub (or where their link goes).
import { ChevronDown, CircleCheck, CircleMinus, CircleX, ExternalLink, ListChecks, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn, useRequest } from "@gasho/plugin-sdk";
import type { JobLog } from "../../../daemon/ops/log.ts";
import type { GitHubCheck } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import { Alert } from "../../ui/alert.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Button, buttonClass } from "../../ui/button.tsx";
import { SkeletonText } from "../../ui/skeleton.tsx";
import { useItem } from "../context.tsx";
import type { ItemTab } from "../parts.ts";

function CheckIcon({ state }: { state: GitHubCheck["state"] }) {
  if (state === "success") return <CircleCheck aria-label="成功" className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (state === "failure") return <CircleX aria-label="失敗" className="size-4 shrink-0 text-red-600 dark:text-red-400" />;
  if (state === "pending") return <LoaderCircle aria-label="実行中" className="size-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />;
  return <CircleMinus aria-label="スキップ" className="size-4 shrink-0 text-muted-foreground" />;
}

function Checks() {
  const { item } = useItem();
  const checks = item.checks ?? [];
  if (checks.length === 0) return <p className="text-sm text-muted-foreground">この Pull request の最新のコミットには、チェックがありません。</p>;
  const count = (s: GitHubCheck["state"]) => checks.filter((c) => c.state === s).length;
  const others = checks.length - count("failure") - count("pending") - count("success");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {count("failure") > 0 && <Badge tone="danger" dot>{`失敗 ${count("failure")}`}</Badge>}
        {count("pending") > 0 && <Badge tone="warning" dot>{`実行中 ${count("pending")}`}</Badge>}
        {count("success") > 0 && <Badge tone="success" dot>{`成功 ${count("success")}`}</Badge>}
        {others > 0 && <Badge dot>{`その他 ${others}`}</Badge>}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-xs">
        {checks.map((c, i) => (
          <CheckRow key={`${c.name}${i}`} check={c} />
        ))}
      </ul>
    </div>
  );
}

function CheckRow({ check }: { check: GitHubCheck }) {
  const { item, where, busy, run } = useItem();
  const [open, setOpen] = useState(false);
  const logId = useId();
  const job = check.state === "failure" && check.run !== undefined && check.job !== undefined ? { run: check.run, job: check.job } : undefined;
  // A check of GitHub Actions has its job's page; the others without a link of their own have the pull request's checks.
  const link = check.url ?? (check.job === undefined ? `${item.url}/checks` : undefined);
  const rerun = (runId: number) =>
    void run({
      id: `rerun:${runId}`,
      op: "rerun",
      params: { run: runId },
      summary: `#${where.number} の失敗したジョブを再実行する（${check.name} のワークフロー）`,
      done: "失敗したジョブを再実行しました",
    });
  return (
    <li>
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
        <CheckIcon state={check.state} />
        {job ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={logId}
            title={open ? "ログを閉じる" : "ログの末尾を読む"}
            className="flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-1 text-left hover:underline"
          >
            <span className="min-w-0 truncate">{check.name}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        ) : link ? (
          <a href={link} target="_blank" rel="noreferrer" className="flex min-h-7 min-w-0 flex-1 items-center gap-1 hover:underline" title={check.name}>
            <span className="min-w-0 truncate">{check.name}</span>
            {check.job === undefined && <ExternalLink aria-label="詳細を開く" className="size-3 shrink-0 text-muted-foreground" />}
          </a>
        ) : (
          <span className="flex min-h-7 min-w-0 flex-1 items-center truncate" title={check.name}>
            {check.name}
          </span>
        )}
        {job && (
          <>
            <Button size="xs" variant="ghost" leftIcon={<RotateCcw />} onClick={() => rerun(job.run)} isLoading={busy === `rerun:${job.run}`} disabled={busy !== undefined} title="このワークフローの失敗したジョブを、すべて再実行する">
              再実行
            </Button>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className={buttonClass("ghost", "icon")} aria-label="GitHub で開く" title="GitHub で開く">
                <ExternalLink />
              </a>
            )}
          </>
        )}
      </div>
      {job && open && <LogTail id={logId} name={check.name} job={job.job} />}
    </li>
  );
}

/** The end of a failed job's log, scrolled to its last line, where the error is. */
function LogTail({ id, name, job }: { id: string; name: string; job: number }) {
  const { machine, where } = useItem();
  // A finished job's log does not change.
  const r = useRequest<JobLog>(readOp(machine, "log", { repo: where.repo, job }), { staleSeconds: 600 });
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [r.data]);
  return (
    <div id={id} className="space-y-2 border-t border-border bg-surface-hover/40 px-3 py-2">
      {r.error && (
        <Alert
          tone="danger"
          action={
            <Button size="xs" onClick={r.reload} isLoading={r.loading}>
              読み直す
            </Button>
          }
        >
          {r.error}
        </Alert>
      )}
      {!r.data && !r.error && r.loading && (
        <div role="status" aria-label="ログを読み込み中">
          <SkeletonText lines={4} />
        </div>
      )}
      {r.data &&
        (r.data.lines.length === 0 ? (
          <p className="text-muted-foreground">ログは空です。</p>
        ) : (
          <>
            {r.data.cut && <p className="text-muted-foreground">ログの末尾です。前の部分は GitHub で読めます。</p>}
            <pre ref={box} tabIndex={0} aria-label={`${name} のログの末尾`} className="max-h-80 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] leading-relaxed">
              {r.data.lines.map((l, i) => (
                <span
                  key={i}
                  className={cn(
                    "block",
                    l.level === "error" && "text-red-600 dark:text-red-400",
                    l.level === "warning" && "text-amber-600 dark:text-amber-400",
                    l.level === "group" && "font-semibold",
                  )}
                >
                  {l.text || " "}
                </span>
              ))}
            </pre>
          </>
        ))}
    </div>
  );
}

export default { id: "checks", label: "チェック", order: 30, kinds: ["pulls"], icon: ListChecks, badge: (item) => item.checks?.length, View: Checks } satisfies ItemTab;
