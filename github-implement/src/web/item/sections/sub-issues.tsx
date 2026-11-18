// An issue's parent and sub-issues, read apart from the item (the operation "sub-issues"). The parent has an × that
// takes the issue off it, or a "+" that chooses one by number; the sub-issues show how many are closed, each has an ×,
// and a "+" adds one by number. An Undo Toast can put each change back. Issues of this repository open here, issues of
// another one on GitHub.
import { ExternalLink, Plus, X } from "lucide-react";
import { useState } from "react";
import { cn, Popover, useNavigation, useRequest } from "@gasho/plugin-sdk";
import type { IssueRef, SubIssues } from "../../../daemon/ops/sub-issues.ts";
import { readOp } from "../../daemon.ts";
import { numberFrom } from "../../../number.ts";
import { itemIcon, NOT_PLANNED_ICON, useRefreshOptions } from "../../tabs.ts";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { useAfterChange, useItem, type Change } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { Row } from "../row.tsx";

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function IssueLink({ issue, repo }: { issue: IssueRef; repo: string }) {
  const nav = useNavigation();
  const here = sameRepo(issue.repo, repo);
  const Icon = issue.state === "closed" && issue.stateReason === "not_planned" ? NOT_PLANNED_ICON : itemIcon({ kind: "issues", state: issue.state });
  const color = issue.state === "open" ? "text-emerald-600 dark:text-emerald-400" : issue.stateReason === "not_planned" ? "text-muted-foreground" : "text-violet-600 dark:text-violet-400";
  const params = { kind: "issues", number: String(issue.number) };
  return (
    <a
      href={here ? nav.worktreeHref("item", params) : issue.url}
      {...(!here && { target: "_blank", rel: "noreferrer" })}
      onClick={(e) => {
        if (!here || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        nav.openWorktreeView("item", params);
      }}
      title={`${issue.repo}#${issue.number}：${issue.title}`}
      className="flex min-w-0 items-center gap-1.5 hover:underline"
    >
      <Icon className={cn("size-3.5 shrink-0", color)} />
      <span className="shrink-0 text-muted-foreground tabular-nums">{here ? `#${issue.number}` : `${issue.repo}#${issue.number}`}</span>
      <span className="min-w-0 truncate">{issue.title}</span>
      {!here && <ExternalLink className="size-3 shrink-0 text-muted-foreground" />}
    </a>
  );
}

/** A "+" that opens a box for the number of an issue of `repo`. */
function NumberAdd({ label, repo, disabled, onAdd }: { label: string; repo: string; disabled: boolean; onAdd: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const n = numberFrom(text, repo);
  const close = () => {
    setOpen(false);
    setText("");
  };
  return (
    <Popover
      label={label}
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      trigger={
        <Button variant="ghost" size="icon" disabled={disabled} aria-label={label} title={label}>
          <Plus />
        </Button>
      }
      className="w-64 p-2"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (n === undefined) return;
          close();
          onAdd(n);
        }}
        className="flex gap-1.5"
      >
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="番号（#17）か URL"
          aria-label={`${label}：Issue の番号`}
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-border-hover"
        />
        <Button type="submit" size="xs" variant="primary" disabled={n === undefined}>
          決める
        </Button>
      </form>
      {text.trim() !== "" && n === undefined && <p className="mt-1.5 px-0.5 text-xs text-muted-foreground">{repo} の Issue の番号か URL を入れてください。</p>}
    </Popover>
  );
}

function SubIssuesRows() {
  const { machine, where, busy, run } = useItem();
  const r = useRequest<SubIssues>(readOp(machine, "sub-issues", { repo: where.repo, number: where.number }), useRefreshOptions());
  useAfterChange(r.reload);
  const data = r.data;
  if (!data) {
    return r.error ? (
      <Row label="親と sub-issue">
        <span className="text-amber-700 dark:text-amber-400">読めませんでした：{r.error}</span>
      </Row>
    ) : (
      <>
        <Row label="親">
          <Skeleton className="h-5 w-40" />
        </Row>
        <Row label="sub-issue">
          <Skeleton className="h-5 w-40" />
        </Row>
      </>
    );
  }
  const id = `#${where.number}`;
  const name = (i: IssueRef) => (sameRepo(i.repo, where.repo) ? `#${i.number}` : `${i.repo}#${i.number}`);
  /** The change that makes `child` a sub-issue of `parent` (add) or takes it off (remove); either may be this issue. */
  const link = (action: "add" | "remove", parent: IssueRef | number, child: IssueRef | number) => {
    const side = (i: IssueRef | number, key: "parent" | "child") =>
      typeof i === "number" ? { [key]: i } : { [key]: i.number, ...(!sameRepo(i.repo, where.repo) && { [`${key}Repo`]: i.repo }) };
    return { op: "sub-issue", params: { action, ...side(parent, "parent"), ...side(child, "child") } };
  };
  const change = (c: Change) => void run(c);
  const children = data.children;
  const closed = children.filter((c) => c.state === "closed").length;
  const parent = data.parent;
  return (
    <>
      <Row label="親">
        {parent ? (
          <>
            <IssueLink issue={parent} repo={where.repo} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${name(parent)} の sub-issue から外す`}
              title={`${name(parent)} の sub-issue から外す`}
              disabled={busy !== undefined}
              isLoading={busy === "parent-"}
              onClick={() =>
                change({
                  id: "parent-",
                  ...link("remove", parent, where.number),
                  summary: `${id} を ${name(parent)} の sub-issue から外す`,
                  done: `${name(parent)} の sub-issue から外しました`,
                  undo: { ...link("add", parent, where.number), summary: `${id} を ${name(parent)} の sub-issue に戻す` },
                })
              }
            >
              <X />
            </Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">なし</span>
            <NumberAdd
              label="親を決める"
              repo={where.repo}
              disabled={busy !== undefined}
              onAdd={(n) =>
                change({
                  id: "parent+",
                  ...link("add", n, where.number),
                  summary: `${id} を #${n} の sub-issue にする`,
                  done: `#${n} の sub-issue にしました`,
                  undo: { ...link("remove", n, where.number), summary: `${id} を #${n} の sub-issue から外す` },
                })
              }
            />
          </>
        )}
      </Row>
      <Row label="sub-issue">
        {children.length === 0 ? (
          <span className="text-muted-foreground">なし</span>
        ) : (
          <>
            <span className="tabular-nums">
              {children.length} 件中 {closed} 件を閉じた
            </span>
            <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <span className="block h-full rounded-full bg-violet-500" style={{ width: `${(closed / children.length) * 100}%` }} />
            </span>
          </>
        )}
        <NumberAdd
          label="sub-issue を足す"
          repo={where.repo}
          disabled={busy !== undefined}
          onAdd={(n) =>
            change({
              id: `sub+${n}`,
              ...link("add", where.number, n),
              summary: `${id} に sub-issue #${n} を足す`,
              done: `sub-issue に #${n} を足しました`,
              undo: { ...link("remove", where.number, n), summary: `${id} の sub-issue から #${n} を外す` },
            })
          }
        />
        {children.length > 0 && (
          <ul aria-label="sub-issue" className="w-full divide-y divide-border overflow-hidden rounded-xl border border-border">
            {children.map((c) => (
              <li key={`${c.repo}#${c.number}`} className="flex items-center gap-2 py-1 pr-1 pl-3">
                <span className="min-w-0 flex-1">
                  <IssueLink issue={c} repo={where.repo} />
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${name(c)} を sub-issue から外す`}
                  title={`${name(c)} を sub-issue から外す`}
                  disabled={busy !== undefined}
                  isLoading={busy === `sub-${c.repo}#${c.number}`}
                  onClick={() =>
                    change({
                      id: `sub-${c.repo}#${c.number}`,
                      ...link("remove", where.number, c),
                      summary: `${id} の sub-issue から ${name(c)} を外す`,
                      done: `sub-issue から ${name(c)} を外しました`,
                      undo: { ...link("add", where.number, c), summary: `${id} に sub-issue ${name(c)} を戻す` },
                    })
                  }
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Row>
    </>
  );
}

export default { order: 38, kinds: ["issues"], place: "row", View: SubIssuesRows } satisfies ItemSection;
