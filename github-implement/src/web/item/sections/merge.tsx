// An open pull request's merge: what keeps it from being merged now (a draft, a conflict, checks, reviews), the methods
// the repository allows, deleting the head branch with it, and auto-merge. Merging asks twice, as it cannot be undone
// here; turning auto-merge on or off can, with an Undo Toast. Read apart from the item (the operation "mergeable").
import { GitMerge } from "lucide-react";
import { useState } from "react";
import { cn, RelativeTime, useRequest } from "@gasho/plugin-sdk";
import type { MergeBlocker, MergeMethod, PullMerge } from "../../../daemon/ops/mergeable.ts";
import { useRefreshOptions } from "../../tabs.ts";
import { Alert } from "../../ui/alert.tsx";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { readOp } from "../../daemon.ts";
import { useAfterChange, useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

const METHOD: Record<MergeMethod, { label: string; hint: string }> = {
  merge: { label: "Merge commit", hint: "コミットをそのまま残し、マージのコミットを足す" },
  squash: { label: "Squash", hint: "コミットを 1 つにまとめる" },
  rebase: { label: "Rebase", hint: "コミットを base の上に並べ直す" },
};

/** What keeps it from being merged, in a sentence. */
function blockerText(b: MergeBlocker, base: string): string {
  switch (b.kind) {
    case "draft":
      return "Draft です。Ready for review にすると、マージできます。";
    case "conflict":
      return `${base} と衝突しています。衝突を解消すると、マージできます。`;
    case "checks":
      return [b.failing.length > 0 && `必須のチェックが通っていません：${b.failing.join("、")}`, b.pending.length > 0 && `必須のチェックが終わっていません：${b.pending.join("、")}`].filter(Boolean).join("。") + "。";
    case "review":
      return b.decision === "changes_requested" ? "修正の依頼が出ています。承認されると、マージできます。" : "必要な承認がそろっていません。";
    case "behind":
      return `${base} より古いので、ブランチを新しくしてからマージします。`;
    case "unknown":
      return "マージできるかを、GitHub がまだ確かめています。少し待って読み直してください。";
    case "rule":
      return `${base} の決まり（ブランチの保護・ルールセット）を満たしていません。GitHub で確かめてください。`;
  }
}

/** What auto-merge waits for; GitHub merges once they are done. */
const WAITS = new Set<MergeBlocker["kind"]>(["checks", "review", "behind", "rule"]);

function Merge() {
  const { machine, where } = useItem();
  const r = useRequest<PullMerge>(readOp(machine, "mergeable", { repo: where.repo, number: where.number }), useRefreshOptions());
  useAfterChange(r.reload);
  const m = r.data;
  return (
    <section aria-label="マージ" className="space-y-2.5 rounded-xl border border-border px-3 py-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <GitMerge className="size-3.5" />
        マージ
      </div>
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
      {!m && !r.error && (
        <div role="status" aria-label="マージの状態を読み込み中" className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-7 w-64 rounded-md" />
        </div>
      )}
      {m && <MergeBody m={m} reload={r.reload} />}
    </section>
  );
}

function MergeBody({ m, reload }: { m: PullMerge; reload: () => void }) {
  const { item, where, busy, run, now } = useItem();
  const id = `#${where.number}`;
  const base = m.base ?? item.base ?? "base";
  const [chosen, setChosen] = useState<MergeMethod>();
  const usable = (x: MergeMethod) => x !== "rebase" || m.rebaseable;
  const method = [chosen, m.preferred, ...m.methods].find((x): x is MergeMethod => x !== undefined && m.methods.includes(x) && usable(x));
  // Not kept between pull requests: deleting a branch is asked for each one.
  const [deleteBranch, setDeleteBranch] = useState(false);
  // The head commit the confirmation was asked with: the merge is of that commit, and GitHub refuses it once the branch
  // has moved. A read that shows another head asks again, before the button can merge.
  const [confirming, setConfirming] = useState<{ head?: string }>();
  const head = m.headOid ? { head: m.headOid } : {};
  const moved = confirming !== undefined && confirming.head !== m.headOid;

  if (m.queued) return <p className="text-muted-foreground">マージキューに入っています。順番が来ると、GitHub がマージします。</p>;

  if (m.auto.on) {
    const on = m.auto.on;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-muted-foreground">
          自動マージが入っています（{METHOD[on.method].label}）。条件がそろうと、GitHub がマージします。
          {on.by && on.at && (
            <>
              {on.by} が<RelativeTime at={on.at} now={now} />
              に入れました。
            </>
          )}
        </p>
        {m.auto.canDisable && (
          <Button
            onClick={() =>
              void run({
                id: "auto-off",
                op: "merge",
                params: { action: "cancel-auto" },
                summary: `${id} の自動マージをやめる`,
                done: "自動マージをやめました",
                undo: { op: "merge", params: { action: "auto", method: on.method }, summary: `${id} の自動マージを入れ直す` },
              })
            }
            disabled={busy !== undefined}
            isLoading={busy === "auto-off"}
            loadingText="やめています…"
          >
            自動マージをやめる
          </Button>
        )}
      </div>
    );
  }

  const blocked = m.blockers.length > 0;
  const waitsOnly = m.blockers.every((b) => WAITS.has(b.kind));
  // A merge queue takes a pull request that still waits, and merges it once it is ready.
  const mergeable = !blocked || (m.queue && waitsOnly);
  // gh merges at once when --auto is asked for a pull request that can be merged now, so auto-merge is offered only
  // for one that waits; a draft or a conflict needs a person first.
  const auto = !m.queue && blocked && waitsOnly && m.auto.allowed && m.auto.canEnable;
  const canDelete = !m.queue && m.head !== undefined && !m.deletesBranch;
  const merge = () => {
    if (!method || !confirming || moved) return;
    setConfirming(undefined);
    void run({
      id: "merge",
      op: "merge",
      params: { action: "merge", method, deleteBranch: canDelete && deleteBranch, ...(confirming.head ? { head: confirming.head } : {}) },
      summary: m.queue ? `${id} をマージキューに入れる` : `${id} を ${METHOD[method].label} でマージする${canDelete && deleteBranch ? `（${m.head} を消す）` : ""}`,
      done: m.queue ? "マージキューに入れました" : canDelete && deleteBranch ? `マージして、${m.head} を消しました` : "マージしました",
    });
  };

  return (
    <div className="space-y-2.5">
      {blocked && (
        <Alert
          tone="warning"
          action={
            m.blockers.some((b) => b.kind === "unknown") ? (
              <Button size="xs" onClick={reload}>
                読み直す
              </Button>
            ) : undefined
          }
        >
          <p className="font-medium">いまはマージできません</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {m.blockers.map((b) => (
              <li key={b.kind}>{blockerText(b, base)}</li>
            ))}
          </ul>
        </Alert>
      )}
      {!blocked && m.unstable.length > 0 && <p className="text-amber-700 dark:text-amber-400">必須でないチェックが通っていません：{m.unstable.join("、")}（マージはできます）</p>}

      {m.methods.length === 0 ? (
        <p className="text-muted-foreground">この repo では、どのマージの方法も許されていません（GitHub の Settings で選べます）。</p>
      ) : (
        !m.queue && (
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className="sr-only">マージの方法</legend>
            {m.methods.map((x) => (
              <label
                key={x}
                title={usable(x) ? METHOD[x].hint : "コミットが base の上に並べ直せません（衝突します）"}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center rounded-md border px-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  x === method ? "border-foreground/40 bg-surface-raised text-foreground" : "border-border text-muted-foreground hover:border-border-hover hover:text-foreground",
                  !usable(x) && "pointer-events-none opacity-40",
                )}
              >
                <input type="radio" name={`merge-method-${where.number}`} value={x} checked={x === method} disabled={!usable(x) || busy !== undefined} onChange={() => setChosen(x)} className="sr-only" />
                {METHOD[x].label}
              </label>
            ))}
          </fieldset>
        )
      )}

      {m.head && !m.queue && (
        <p className="text-muted-foreground">
          {m.deletesBranch ? (
            <>
              マージすると、GitHub が <span className="font-mono">{m.head}</span> を消します（repo の設定）。
            </>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} disabled={busy !== undefined} className="size-3.5 accent-current" />
              {/* One span: three nodes of a flex row would each wrap apart in a narrow width. */}
              <span>
                マージしたら、GitHub の <span className="font-mono break-all">{m.head}</span> を消す
              </span>
            </label>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {confirming && method && moved ? (
          <>
            <span className="w-full text-amber-700 dark:text-amber-400">
              確認を出したあとに、head のブランチに push がありました{confirming.head && m.headOid ? `（${confirming.head.slice(0, 7)} → ${m.headOid.slice(0, 7)}）` : ""}。中身を確かめてから、もう一度確認してください。
            </span>
            <Button variant="primary" onClick={() => setConfirming(head)} disabled={!mergeable || busy !== undefined}>
              もう一度確認する
            </Button>
            <Button onClick={() => setConfirming(undefined)} disabled={busy !== undefined}>
              やめる
            </Button>
          </>
        ) : confirming && method ? (
          <>
            <Button variant="primary" onClick={merge} isLoading={busy === "merge"} loadingText="マージしています…" disabled={!mergeable || busy !== undefined}>
              {m.queue ? "マージキューに入れる" : `${METHOD[method].label} でマージする`}
            </Button>
            <Button onClick={() => setConfirming(undefined)} disabled={busy !== undefined}>
              やめる
            </Button>
            <span className="text-muted-foreground">マージは、ここでは元に戻せません。</span>
          </>
        ) : (
          <Button variant="primary" leftIcon={<GitMerge />} onClick={() => setConfirming(head)} disabled={!mergeable || !method || busy !== undefined} isLoading={busy === "merge"} loadingText="マージしています…">
            {m.queue ? "マージキューに入れる…" : "マージする…"}
          </Button>
        )}
        {auto && method && !confirming && (
          <Button
            onClick={() =>
              void run({
                id: "auto-on",
                op: "merge",
                params: { action: "auto", method, ...head },
                summary: `${id} の自動マージを入れる（${METHOD[method].label}）`,
                done: "自動マージを入れました。条件がそろうと、GitHub がマージします",
                undo: { op: "merge", params: { action: "cancel-auto" }, summary: `${id} の自動マージをやめる` },
              })
            }
            disabled={busy !== undefined}
            isLoading={busy === "auto-on"}
            loadingText="入れています…"
          >
            自動マージを入れる
          </Button>
        )}
        {!m.queue && blocked && waitsOnly && !m.auto.allowed && <span className="text-muted-foreground">この repo では自動マージが許されていません（GitHub の Settings で選べます）。</span>}
      </div>
    </div>
  );
}

function MergeSection() {
  const { item } = useItem();
  return item.state === "open" ? <Merge /> : null;
}

export default { order: 50, kinds: ["pulls"], View: MergeSection } satisfies ItemSection;
