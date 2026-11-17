// What the page asks and tells around the rows' buttons: whether Claude Code may trust a folder before a session
// starts there, whether to remove a review worktree, whether to ask the Agent to merge, and a notice at the bottom of
// what a button is doing or did.
import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect } from "react";
import { cn } from "@gasho/plugin-sdk";
import type { MergeMethod } from "../instructions.ts";
import { canPush } from "../types.ts";
import { sessionsIn, type Item, type Notice, type Spot } from "./actions";
import { Button } from "./ui/parts";
import { DIALOG_OVERLAY, DIALOG_PANEL, motionTransitions } from "./ui/styles";

/** Claude Code asks whether to trust a folder before a session starts there: the person answers here. */
export function TrustDialog({ question, onAnswer }: { question: { path: string; warnings: string[] } | undefined; onAnswer: (yes: boolean) => void }) {
  return (
    <Dialog.Root open={Boolean(question)} onOpenChange={(next) => !next && onAnswer(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={cn(DIALOG_PANEL, "flex flex-col gap-4")}>
          <div className="space-y-1.5">
            <Dialog.Title className="text-base font-semibold tracking-tight">このフォルダーを信頼しますか</Dialog.Title>
            <Dialog.Description className="text-xs leading-relaxed text-muted-foreground">
              Claude Code は、このフォルダーをまだ信頼していません。信頼すると、セッションはこのフォルダーのファイルを読み書きし、コマンドを実行できます。
            </Dialog.Description>
          </div>
          <p className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs break-all">{question?.path}</p>
          {(question?.warnings.length ?? 0) > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">
              {question?.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button size="sm" onClick={() => onAnswer(false)}>
              やめる
            </Button>
            <Button size="sm" variant="primary" onClick={() => onAnswer(true)}>
              信頼して起動する
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Before a review worktree is removed: what goes, and the sessions that keep running in it. */
export function RemoveDialog({ question, onAnswer }: { question: { item: Item; spot: Spot } | undefined; onAnswer: (yes: boolean) => void }) {
  const wt = question?.spot.worktree;
  const running = question && wt ? sessionsIn(question.spot.machine, wt.path).length : 0;
  return (
    <Dialog.Root open={Boolean(question)} onOpenChange={(next) => !next && onAnswer(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={cn(DIALOG_PANEL, "flex flex-col gap-4")}>
          <div className="space-y-1.5">
            <Dialog.Title className="text-base font-semibold tracking-tight">レビュー用の worktree を片付けますか</Dialog.Title>
            <Dialog.Description className="text-xs leading-relaxed text-muted-foreground">
              {wt?.missing ? "フォルダーはもうありません。git に残っている worktree の登録" : "worktree のフォルダー"}{wt?.branch ? "とローカルのブランチ" : ""}を消します。未コミットの変更か、push していない commit があるときは、消さずに理由を出します。
            </Dialog.Description>
          </div>
          <dl className="space-y-1 rounded-lg border border-border bg-background px-3 py-2 text-xs">
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">フォルダー</dt>
              <dd className="font-mono break-all">{wt?.path}</dd>
            </div>
            {wt?.branch && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">ブランチ</dt>
                <dd className="font-mono break-all">{wt.branch}</dd>
              </div>
            )}
          </dl>
          {running > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">このフォルダーで、Gasho のセッションが {running} 個動いています。片付けても、セッションは止まりません。</p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button size="sm" onClick={() => onAnswer(false)}>
              やめる
            </Button>
            <Button size="sm" variant="primary" onClick={() => onAnswer(true)}>
              片付ける
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const METHOD_TEXT: Record<MergeMethod, string> = { merge: "merge（マージコミットを作る）", squash: "squash", rebase: "rebase" };

/** Before the Agent is asked to merge: what it will do, with the settings of the merge. */
export function MergeDialog({
  question,
  merge,
  onAnswer,
}: {
  question: { item: Item; spot: Spot } | undefined;
  merge: { method: MergeMethod; deleteBranch: boolean };
  onAnswer: (yes: boolean) => void;
}) {
  const pr = question?.item.pr;
  const steps = pr
    ? [
        canPush(pr) ? "base とのコンフリクトがあれば取り込んで解決し、push します。解決で中身が変わったときは、マージせずにコメントします" : "base とのコンフリクトがあれば、マージせずに止めます（head に push できないため）",
        "チェックが通るのを待ちます",
        pr.own ? "自分の Pull request なので、approve はしません" : "レビューの結果を元に approve します",
        `${METHOD_TEXT[merge.method]} でマージします`,
        ...(merge.deleteBranch && !pr.fork ? [`GitHub の head のブランチ（${pr.branch}）を消します`] : []),
      ]
    : [];
  return (
    <Dialog.Root open={Boolean(question)} onOpenChange={(next) => !next && onAnswer(false)}>
      <Dialog.Portal>
        {/* The portal lands outside the plugin's part of the page, where its CSS would not apply. */}
        <div data-gasho-plugin="github-review" style={{ display: "contents" }}>
          <Dialog.Overlay className={DIALOG_OVERLAY} />
          <Dialog.Content className={cn(DIALOG_PANEL, "flex flex-col gap-4")}>
            <div className="space-y-1.5">
              <Dialog.Title className="text-base font-semibold tracking-tight">Agent にマージを頼みますか</Dialog.Title>
              <Dialog.Description className="text-xs leading-relaxed text-muted-foreground">
                #{pr?.number}「{pr?.title}」の worktree のセッションに指示を送ります。セッションが作業中なら、終わってから入力されます。
              </Dialog.Description>
            </div>
            <ol className="list-decimal space-y-1 rounded-lg border border-border bg-background py-2 pr-3 pl-7 text-xs">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="text-[11px] text-muted-foreground">マージ方法とブランチを消すかは、設定で変えられます。</p>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button size="sm" onClick={() => onAnswer(false)}>
                やめる
              </Button>
              <Button size="sm" variant="primary" onClick={() => onAnswer(true)}>
                マージを頼む
              </Button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A notice at the bottom of the page (after EasyUI's VelocityToast); it goes after a few seconds once nothing is going on. */
export function Toast({ notice, onClose }: { notice: Notice | undefined; onClose: () => void }) {
  useEffect(() => {
    if (!notice || notice.busy) return;
    const t = setTimeout(onClose, notice.action ? 10_000 : 6000);
    return () => clearTimeout(t);
    // Restarts only for a new notice.
  }, [notice]);
  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          key={notice.text}
          role={notice.tone === "danger" ? "alert" : "status"}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={motionTransitions.springSnappy}
          className={cn(
            "fixed bottom-4 left-1/2 z-[95] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-surface px-4 py-2.5 text-sm shadow-xl",
            notice.tone === "danger" ? "border-red-500/40 text-red-600 dark:text-red-300" : "border-border text-foreground",
          )}
        >
          {notice.busy && <LoaderCircle className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin" />}
          <span className="min-w-0">{notice.text}</span>
          {notice.action && (
            <button
              type="button"
              onClick={() => {
                notice.action?.run();
                onClose();
              }}
              className="shrink-0 cursor-pointer text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {notice.action.label}
            </button>
          )}
          {!notice.busy && (
            <button type="button" onClick={onClose} aria-label="閉じる" className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
