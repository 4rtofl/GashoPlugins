// The rest of what GitHub's sidebar does to an item, after the buttons that change the state: lock and unlock the
// conversation, pin and unpin an issue and move it to another repository, and open a pull request that reverts a
// merged one. An Undo Toast can put a lock or a pin back. Moving gives the issue a new number in the other repository
// and reverting makes a new pull request, so neither can be put back that way: each asks first, and then says where
// the issue or pull request is.
import { ArrowRight, ExternalLink, Lock, LockOpen, Pin, PinOff, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Popover, useNavigation, useRequest } from "@gasho/plugin-sdk";
import type { LockReason } from "../../../daemon/ops/lock.ts";
import type { LockState } from "../../../daemon/ops/locked.ts";
import type { Reverted } from "../../../daemon/ops/revert.ts";
import type { Moved } from "../../../daemon/ops/transfer.ts";
import { readOp, useWriteOp } from "../../daemon.ts";
import { useRefreshOptions } from "../../tabs.ts";
import { Alert } from "../../ui/alert.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Button, buttonClass } from "../../ui/button.tsx";
import { useToast } from "../../ui/toast.tsx";
import { useAfterChange, useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

const REASONS: Record<LockReason, string> = { off_topic: "話題から外れている", too_heated: "白熱しすぎている", resolved: "解決した", spam: "スパム" };

const MENU_ITEM = "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised disabled:pointer-events-none disabled:opacity-40";

function LockControl() {
  const { machine, where, busy, run } = useItem();
  const r = useRequest<LockState>(readOp(machine, "locked", { repo: where.repo, number: where.number }), useRefreshOptions());
  useAfterChange(r.reload);
  const [open, setOpen] = useState(false);
  const id = `#${where.number}`;
  if (!r.data) {
    return r.error ? (
      <span className="text-xs text-muted-foreground" title={r.error}>
        ロックの状態を読めませんでした
      </span>
    ) : null;
  }
  const unlock = { op: "lock", params: { lock: false }, summary: `${id} の会話のロックを外す` };
  if (r.data.locked) {
    const reason = r.data.reason;
    return (
      <>
        <Badge tone="warning" icon={<Lock />}>
          ロック中{reason ? `（${REASONS[reason]}）` : ""}
        </Badge>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={<LockOpen />}
          disabled={busy !== undefined}
          isLoading={busy === "unlock"}
          loadingText="外しています…"
          onClick={() =>
            void run({ id: "unlock", ...unlock, done: "会話のロックを外しました", undo: { op: "lock", params: { lock: true, ...(reason && { reason }) }, summary: `${id} の会話をロックし直す` } })
          }
        >
          ロックを外す
        </Button>
      </>
    );
  }
  const lock = (reason?: LockReason) => {
    setOpen(false);
    void run({
      id: "lock",
      op: "lock",
      params: { lock: true, ...(reason && { reason }) },
      summary: `${id} の会話をロックする${reason ? `（${REASONS[reason]}）` : ""}`,
      done: "会話をロックしました",
      undo: unlock,
    });
  };
  return (
    <Popover
      label="会話をロックする"
      open={open}
      onOpenChange={setOpen}
      className="w-64 p-1"
      trigger={
        <Button variant="ghost" size="xs" leftIcon={<Lock />} disabled={busy !== undefined} isLoading={busy === "lock"} loadingText="ロックしています…">
          会話をロックする
        </Button>
      }
    >
      <p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">ロックすると、書き込みの権限がある人だけがコメントできます。理由を選んでください。</p>
      <button type="button" onClick={() => lock()} className={MENU_ITEM}>
        理由を付けない
      </button>
      {(Object.keys(REASONS) as LockReason[]).map((k) => (
        <button key={k} type="button" onClick={() => lock(k)} className={MENU_ITEM}>
          {REASONS[k]}
        </button>
      ))}
    </Popover>
  );
}

function PinControl() {
  const { item, where, busy, run } = useItem();
  const id = `#${where.number}`;
  const pin = { op: "pin", params: { pin: true }, summary: `${id} をピン留めする` };
  const unpin = { op: "pin", params: { pin: false }, summary: `${id} のピン留めを外す` };
  return item.pinned ? (
    <>
      <Badge icon={<Pin />}>ピン留め中</Badge>
      <Button variant="ghost" size="xs" leftIcon={<PinOff />} disabled={busy !== undefined} isLoading={busy === "unpin"} loadingText="外しています…" onClick={() => void run({ id: "unpin", ...unpin, done: "ピン留めを外しました", undo: pin })}>
        ピン留めを外す
      </Button>
    </>
  ) : (
    <Button
      variant="ghost"
      size="xs"
      leftIcon={<Pin />}
      title="repo の Issue の一覧の上に出す（3 件まで）"
      disabled={busy !== undefined}
      isLoading={busy === "pin"}
      loadingText="ピン留めしています…"
      onClick={() => void run({ id: "pin", ...pin, done: "ピン留めしました", undo: unpin })}
    >
      ピン留めする
    </Button>
  );
}

function TransferControl({ onMoved }: { onMoved: (notice: ReactNode) => void }) {
  const { machine, where, busy } = useItem();
  const write = useWriteOp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string>();
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState(false);
  // Read when the popup opens: one or two GraphQL points, kept for 10 minutes by gasho-daemon.
  const targets = useRequest<string[]>(open ? readOp(machine, "transfer-targets", { repo: where.repo }) : undefined, { staleSeconds: 300 });
  const id = `#${where.number}`;
  const q = query.trim().toLowerCase();
  const shown = targets.data?.filter((t) => !q || t.toLowerCase().includes(q));
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTo(undefined);
      setQuery("");
    }
  };
  const move = async (target: string) => {
    close(false);
    setMoving(true);
    const summary = `${id} を ${target} に移す`;
    const res = await write(machine, "transfer", { ...where, to: target }, summary);
    setMoving(false);
    if (!res.ok) {
      toast({ title: `「${summary}」ができませんでした`, description: res.error, tone: "error" });
      return;
    }
    const moved = res.data as Moved;
    toast({ title: `${target} に移しました` });
    onMoved(
      <Alert
        action={
          moved.url && (
            <a href={moved.url} target="_blank" rel="noreferrer" className={buttonClass("secondary", "xs")}>
              GitHub で開く <ExternalLink />
            </a>
          )
        }
      >
        {id} を {target} に移しました{moved.number ? `（移した先の番号は #${moved.number}）` : ""}。この画面の番号では、もう読めません。
      </Alert>,
    );
  };
  return (
    <Popover
      label="別の repo に移す"
      open={open}
      onOpenChange={close}
      className="w-72 p-1"
      trigger={
        <Button variant="ghost" size="xs" leftIcon={<ArrowRight />} disabled={busy !== undefined || moving} isLoading={moving} loadingText="移しています…">
          別の repo に移す
        </Button>
      }
    >
      {to ? (
        <div className="space-y-2 p-2 text-xs">
          <p>
            {id} を {to} に移します。移した先では番号が変わり、元に戻すにはもう一度移します（番号はまた変わります）。
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size="xs" onClick={() => void move(to)}>
              移す
            </Button>
            <Button size="xs" onClick={() => setTo(undefined)}>
              戻る
            </Button>
          </div>
        </div>
      ) : (
        <>
          {targets.data && targets.data.length > 0 && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                const first = shown?.[0];
                if (e.key === "Enter" && first) {
                  e.preventDefault();
                  setTo(first);
                }
              }}
              placeholder="名前で探す"
              aria-label="移す先の repo：名前で探す"
              className="mb-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-border-hover"
            />
          )}
          <div className="max-h-64 overflow-y-auto">
            {targets.error && <p className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">{targets.error}</p>}
            {!targets.data && !targets.error && <p className="px-2 py-1.5 text-xs text-muted-foreground">読み込み中…</p>}
            {targets.data?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">移せる repo がありません（同じ owner で、Issue があり、書き込める repo だけに移せます）。</p>}
            {targets.data && targets.data.length > 0 && shown?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">「{query}」に合う repo がありません。</p>}
            {shown?.map((t) => (
              <button key={t} type="button" onClick={() => setTo(t)} className={MENU_ITEM}>
                {t}
              </button>
            ))}
          </div>
        </>
      )}
    </Popover>
  );
}

function RevertControl({ onMade }: { onMade: (notice: ReactNode) => void }) {
  const { machine, where, busy } = useItem();
  const write = useWriteOp();
  const toast = useToast();
  const nav = useNavigation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(false);
  const [making, setMaking] = useState(false);
  const id = `#${where.number}`;
  const make = async () => {
    setOpen(false);
    setMaking(true);
    const summary = `${id} を Revert する Pull request を作る`;
    const res = await write(machine, "revert", { ...where, draft }, summary);
    setMaking(false);
    if (!res.ok) {
      toast({ title: `「${summary}」ができませんでした`, description: res.error, tone: "error" });
      return;
    }
    const pr = res.data as Reverted;
    const params = { kind: "pulls", number: String(pr.number) };
    toast({ title: `Revert する Pull request #${pr.number} を作りました` });
    onMade(
      <Alert
        action={
          <span className="flex gap-1.5">
            <a
              href={nav.worktreeHref("item", params)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                nav.openWorktreeView("item", params);
              }}
              className={buttonClass("secondary", "xs")}
            >
              #{pr.number} を開く
            </a>
            <a href={pr.url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "xs")}>
              GitHub <ExternalLink />
            </a>
          </span>
        }
      >
        {id} を Revert する Pull request #{pr.number} を作りました。
      </Alert>,
    );
  };
  return (
    <Popover
      label="Revert する Pull request を作る"
      open={open}
      onOpenChange={setOpen}
      className="w-72 p-2"
      trigger={
        <Button variant="ghost" size="xs" leftIcon={<RotateCcw />} disabled={busy !== undefined || making} isLoading={making} loadingText="作っています…">
          Revert する Pull request を作る
        </Button>
      }
    >
      <div className="space-y-2 text-xs">
        <p>{id} の変更を元に戻すコミットを新しいブランチに作り、その Pull request を開きます（GitHub の Revert ボタンと同じ）。</p>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          Draft で作る
        </label>
        <div className="flex gap-2">
          <Button variant="primary" size="xs" onClick={() => void make()}>
            作る
          </Button>
          <Button size="xs" onClick={() => setOpen(false)}>
            やめる
          </Button>
        </div>
      </div>
    </Popover>
  );
}

function More() {
  const { item } = useItem();
  // What moving and reverting made, shown until the screen closes.
  const [notice, setNotice] = useState<ReactNode>();
  return (
    <>
      <LockControl />
      {item.kind === "issues" && <PinControl />}
      {item.kind === "issues" && <TransferControl onMoved={setNotice} />}
      {item.kind === "pulls" && item.state === "merged" && <RevertControl onMade={setNotice} />}
      {notice && <div className="basis-full text-left">{notice}</div>}
    </>
  );
}

export default { order: 15, kinds: ["issues", "pulls"], place: "actions", View: More } satisfies ItemSection;
