// A merged pull request opened in the worktree of its head branch: removing that worktree and the sessions in it, as
// the menu of the worktree's row in Gasho's sidebar does (useRemoveWorktree, plugin API 1.10). It asks first, naming
// the folder, the branch and the sessions that end, with the local branch deleted too by default. The head commit goes
// as pushed, so a squash merge whose branch GitHub deleted is no reason to ask more; uncommitted changes or other
// commits are, and only a second press ("変更を捨てて削除") removes the worktree with them. Once it is gone, Gasho moves
// to the home screen, as this screen's worktree is no more. Where it is the place of the open pull request's merge.
import { FolderX, GitBranch, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { removeWorktreeProblem, useRemoveWorktree } from "@gasho/plugin-sdk";
import { Alert } from "../../ui/alert.tsx";
import { Button } from "../../ui/button.tsx";
import { changesText, isMergedHeadWorktree, pushedOf, sessionName, sessionsIn, type Changes } from "../cleanup.ts";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

function MergedCleanup() {
  const { machineInfo, worktree, item, busy } = useItem();
  const [open, setOpen] = useState(false);
  const problem = removeWorktreeProblem(machineInfo, worktree);
  return (
    <section aria-label="マージ済み" className="space-y-2 rounded-xl border border-border px-3 py-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <FolderX className="size-3.5" />
        マージ済み
      </div>
      <p className="text-muted-foreground">
        この Pull request はマージされました。<span className="font-mono break-all">{item.head}</span> の worktree が要らなければ、中のセッションと一緒に削除できます。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="destructive" leftIcon={<Trash2 />} onClick={() => setOpen(true)} disabled={problem !== undefined || busy !== undefined}>
          worktree とセッションを削除…
        </Button>
        {problem && <span className="text-muted-foreground">{problem}</span>}
      </div>
      {open && <RemoveDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

type Step = { kind: "ask" } | { kind: "removing"; force: boolean } | { kind: "changes"; changes: Changes } | { kind: "failed"; error: string };

function RemoveDialog({ onClose }: { onClose: () => void }) {
  const { machine, machineInfo, worktree, item } = useItem();
  const remove = useRemoveWorktree();
  const dialog = useRef<HTMLDialogElement>(null);
  // Whether the press now going on began on the backdrop: one that began inside (selecting the folder) ends nothing.
  const pressedBackdrop = useRef(false);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [step, setStep] = useState<Step>({ kind: "ask" });
  const branch = worktree.branch;
  const sessions = sessionsIn(machineInfo, worktree.path);
  const removing = step.kind === "removing";
  const problem = removeWorktreeProblem(machineInfo, worktree);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const go = async (force: boolean) => {
    setStep({ kind: "removing", force });
    const pushed = pushedOf(item);
    const res = await remove({
      machine,
      path: worktree.path,
      ...(deleteBranch && branch ? { branch } : {}),
      ...(force ? { force: true } : {}),
      ...(pushed ? { pushed } : {}),
    });
    // When it is gone, Gasho leaves this screen, and the dialog with it.
    if (res.ok) return;
    setStep(res.changes && !force ? { kind: "changes", changes: res.changes } : { kind: "failed", error: res.error });
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="merged-cleanup-title"
      onClose={onClose}
      onCancel={(e) => removing && e.preventDefault()}
      onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => !removing && pressedBackdrop.current && e.target === e.currentTarget && e.currentTarget.close()}
      className="mx-auto my-auto w-[min(32rem,calc(100vw-2rem))] max-w-none rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/40"
    >
      <div className="space-y-3 p-4 text-xs">
        <h3 id="merged-cleanup-title" className="text-sm font-semibold">
          worktree とセッションを削除
        </h3>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">フォルダー</dt>
          <dd className="font-mono break-all">{worktree.path}</dd>
          <dt className="text-muted-foreground">ブランチ</dt>
          <dd className="flex items-center gap-1 font-mono break-all">
            <GitBranch className="size-3 shrink-0 text-muted-foreground" />
            {branch}
          </dd>
          <dt className="text-muted-foreground">working server</dt>
          <dd className="break-all">{machineInfo.name}</dd>
        </dl>
        {sessions.length > 0 ? (
          <div className="space-y-1">
            <p>一緒に終わるセッション（{sessions.length}）</p>
            <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4 text-muted-foreground">
              {sessions.map((s) => (
                <li key={s.sessionId} className="break-all">
                  {sessionName(s)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">この worktree にセッションはありません。</p>
        )}
        {branch && (
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} disabled={removing || step.kind === "changes"} className="size-3.5 accent-current" />
            ローカルのブランチ <span className="font-mono break-all">{branch}</span> も消す
          </label>
        )}

        {step.kind === "changes" && (
          <Alert tone="warning">
            <p className="font-medium">{changesText(step.changes)}</p>
            <p className="mt-1 text-xs">削除すると、これらは失われます。それでも消すなら「変更を捨てて削除」を押してください。</p>
          </Alert>
        )}
        {step.kind === "failed" && <Alert tone="danger">{step.error}</Alert>}
        {problem && step.kind !== "removing" && <Alert tone="warning">{problem}</Alert>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button onClick={() => dialog.current?.close()} disabled={removing}>
            やめる
          </Button>
          {step.kind === "changes" || (step.kind === "removing" && step.force) ? (
            <Button variant="destructive" onClick={() => void go(true)} isLoading={removing} loadingText="削除しています…" disabled={problem !== undefined}>
              変更を捨てて削除
            </Button>
          ) : (
            <Button variant="destructive" leftIcon={<Trash2 />} onClick={() => void go(false)} isLoading={removing} loadingText="削除しています…" disabled={problem !== undefined}>
              削除する
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}

function MergedSection() {
  const { item, worktree } = useItem();
  return isMergedHeadWorktree(item, worktree) ? <MergedCleanup /> : null;
}

export default { order: 50, kinds: ["pulls"], View: MergedSection } satisfies ItemSection;
