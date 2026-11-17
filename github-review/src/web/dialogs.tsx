// What the page asks and tells around the rows' buttons: whether Claude Code may trust a folder before a session
// starts there, whether to remove a review worktree, and a notice at the bottom of what a button is doing or did.
import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect } from "react";
import { cn } from "@gasho/plugin-sdk";
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

/** A notice at the bottom of the page (after EasyUI's VelocityToast); it goes after a few seconds once nothing is going on. */
export function Toast({ notice, onClose }: { notice: Notice | undefined; onClose: () => void }) {
  useEffect(() => {
    if (!notice || notice.busy) return;
    const t = setTimeout(onClose, 6000);
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
