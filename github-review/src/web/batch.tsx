// "まとめてレビューさせる" at the head of the pull requests GitHub asks me to review: a template (and, with several working
// servers, where to make them) from its menu, then a dialog with the pull requests it would make a review worktree and a
// session for, ticked; it shows how each went while it runs (batch-run.ts), and each session started can be opened from
// there.
import { Ban, Check, ChevronDown, CircleAlert, Clock, ExternalLink, LoaderCircle, Sparkles } from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { cn, type MachineInfo } from "@gasho/plugin-sdk";
import { batchTargets } from "../items.ts";
import type { Template } from "../template.ts";
import type { BatchStep, Item } from "./actions";
import type { BatchChoice, BatchRun, BatchTarget } from "./batch-run";
import { Button, DrawCheckbox, PortalScope } from "./ui/parts";
import { DIALOG_OVERLAY, DIALOG_PANEL, MENU, MENU_ITEM } from "./ui/styles";

/** The button with its menu: a template for each working server that has pull requests to do and can start sessions. */
export function BatchMenu({
  items,
  machines,
  templates,
  disabled,
  onPick,
}: {
  items: Item[];
  machines: MachineInfo[];
  templates: Template[];
  disabled: boolean;
  onPick: (c: BatchChoice) => void;
}) {
  const where = machines.flatMap((machine) => {
    const targets = batchTargets(items, machine);
    return targets.length > 0 ? [{ machine, targets }] : [];
  });
  const none =
    where.length === 0
      ? "開いている Pull request のうち、worktree の無いものがありません（fork の Pull request は対象にしません）。"
      : templates.length === 0
        ? "設定で、送る指示のテンプレートを足してください。"
        : undefined;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" leftIcon={<Sparkles />} disabled={disabled || Boolean(none)} title={none}>
          まとめてレビューさせる
          <ChevronDown className="ml-0.5 inline size-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PortalScope>
          <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
            {where.map(({ machine, targets }, i) => (
              <DropdownMenu.Group key={machine.id}>
                {i > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
                <DropdownMenu.Label className="px-2.5 pt-1 pb-1.5 text-[11px] text-muted-foreground">
                  {where.length > 1 || machines.length > 1
                    ? `${machine.name} の ${targets.length} 件に送る指示`
                    : `開いていて worktree の無い ${targets.length} 件に送る指示`}
                  {items.some((item) => item.pr.fork && item.pr.state === "open") && <span className="block">fork の Pull request は対象にしません。行のボタンから 1 件ずつ始めてください。</span>}
                  {!machine.canLaunch && (
                    <span className="block text-amber-700 dark:text-amber-300">この working server では、Gasho からセッションを起動できません。</span>
                  )}
                </DropdownMenu.Label>
                {templates.map((t, j) => (
                  <DropdownMenu.Item
                    key={j}
                    disabled={!machine.canLaunch}
                    onSelect={() => onPick({ machine, template: t, targets })}
                    className={MENU_ITEM}
                    title={t.body}
                  >
                    {t.name}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Group>
            ))}
          </DropdownMenu.Content>
        </PortalScope>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const STEP_LOOK: Record<BatchStep["state"], { Icon: typeof Check; className: string; label: string }> = {
  waiting: {
    Icon: Clock,
    className: "text-muted-foreground",
    label: "待っています",
  },
  working: {
    Icon: LoaderCircle,
    className: "text-muted-foreground motion-safe:animate-spin",
    label: "用意しています",
  },
  done: {
    Icon: Check,
    className: "text-emerald-600 dark:text-emerald-400",
    label: "レビューを始めました",
  },
  skipped: {
    Icon: Ban,
    className: "text-muted-foreground",
    label: "飛ばしました",
  },
  failed: {
    Icon: CircleAlert,
    className: "text-red-600 dark:text-red-400",
    label: "できませんでした",
  },
};

/**
 * Asks which of the pull requests of `choice` to do; once started, shows how each of the run's goes. Closing the dialog
 * while it runs only hides it: the run goes on, even away from the page (batch-run.ts), and the notice at the bottom
 * tells how far it is.
 */
export function BatchDialog({
  choice,
  run,
  onStart,
  onOpen,
  onClose,
}: {
  /** What the person chose from the menu, before it starts. */
  choice: BatchChoice | undefined;
  /** The run whose dialog is open. */
  run: BatchRun | undefined;
  onStart: (targets: BatchTarget[]) => void;
  onOpen: (sessionId: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (choice) setPicked(new Set(choice.targets.map((x) => x.item.pr.url)));
  }, [choice]);
  const steps: Record<string, BatchStep> | undefined = choice ? undefined : run?.steps;
  const started = Boolean(steps);
  const running = started && run?.running === true;
  const shown = choice?.targets ?? run?.targets ?? [];
  const template = (choice ?? run)?.template;
  const toggle = (url: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  return (
    <Dialog.Root open={Boolean(choice ?? run)} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <PortalScope>
          <Dialog.Overlay className={DIALOG_OVERLAY} />
          <Dialog.Content className={cn(DIALOG_PANEL, "flex w-[min(34rem,calc(100vw-2rem))] flex-col gap-4")}>
            <div className="space-y-1.5">
              <Dialog.Title className="text-base font-semibold tracking-tight">
                {!started ? "まとめてレビューさせますか" : running ? "まとめてレビューさせています" : "まとめてレビューさせました"}
              </Dialog.Title>
              <Dialog.Description className="text-xs leading-relaxed text-muted-foreground">
                {started
                  ? running
                    ? "1 件ずつ、worktree を作ってセッションを起動し、指示を送っています。閉じても、ほかの画面に移っても続けます。フォルダーを信頼するかは、このページで聞きます。ほかの画面にいるあいだは、このページに戻るまで待ちます。"
                    : "終わりました。始めたセッションは、ここかサイドバーから開けます。"
                  : `選んだ Pull request ごとに、レビュー用の worktree を作ってセッションを起動し、「${template?.name ?? ""}」を送ります。セッションは開かずに、1 件ずつ進めます。`}
              </Dialog.Description>
            </div>
            <ul className="max-h-[50dvh] divide-y divide-black/[0.05] overflow-y-auto rounded-xl border border-border dark:divide-white/[0.05]">
              {shown.map(({ item: { pr } }) => {
                const step = steps?.[pr.url];
                const title = (
                  <>
                    <span className="text-muted-foreground">
                      {pr.repo}#{pr.number}
                    </span>{" "}
                    <span className="font-medium">{pr.title}</span>
                  </>
                );
                if (!step) {
                  return (
                    <li key={pr.url} className="px-3 py-2.5">
                      <DrawCheckbox checked={picked.has(pr.url)} onChange={() => toggle(pr.url)} label={title} description={pr.draft ? "Draft" : undefined} />
                    </li>
                  );
                }
                const look = STEP_LOOK[step.state];
                return (
                  <li key={pr.url} className="flex items-start gap-2.5 px-3 py-2.5">
                    <span title={look.label} className="mt-0.5 inline-flex shrink-0">
                      <look.Icon className={cn("size-4", look.className)} aria-label={look.label} />
                    </span>
                    <div className="min-w-0 flex-1 text-sm leading-tight">
                      <p className="break-words">{title}</p>
                      {step.text && (
                        <p
                          className={cn(
                            "mt-0.5 text-[11px] break-words",
                            // On one done, what did not go as asked in sending.
                            step.state === "failed" ? "text-red-600 dark:text-red-300" : step.state === "done" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
                          )}
                        >
                          {step.text}
                        </p>
                      )}
                    </div>
                    {step.sessionId && (
                      <Button size="sm" variant="ghost" className="-my-1" leftIcon={<ExternalLink />} onClick={() => step.sessionId && onOpen(step.sessionId)}>
                        開く
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              {started ? (
                <Button size="sm" onClick={onClose}>
                  閉じる
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={onClose}>
                    やめる
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={picked.size === 0}
                    onClick={() => choice && onStart(choice.targets.filter((x) => picked.has(x.item.pr.url)))}
                  >
                    {picked.size} 件のレビューを始める
                  </Button>
                </>
              )}
            </div>
          </Dialog.Content>
        </PortalScope>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
