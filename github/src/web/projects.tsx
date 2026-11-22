// The Projects panels: the projects linked to the repository and its owner's others, and one project as a board whose
// columns are the options of a single select field or the iterations of an iteration field (the one its board view
// uses, else Status). The board scrolls sideways when its columns do not fit the panel. The views' filters are not
// applied: every item not archived shows.
import { ArrowLeft, CircleCheck, CircleDot, CircleSlash, FileText, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, KanbanSquare, Lock } from "lucide-react";
import { cn, relativeTime, useNavigation, useNow, type PanelProps } from "@gasho/plugin-sdk";
import type { Board, BoardItem, ProjectRef, Projects } from "../types.ts";
import { Empty, LoadedAt, MissingScopeNote, PanelFrame, PanelRepoTabs, Status, usePanelRepo, useRead } from "./common";

/** Open projects and closed ones read per list (PROJECTS_MAX of the daemon part). */
const PROJECTS_MAX = 50;

/** GitHub's colors of a single select's options. */
const OPTION_COLOR: Record<string, string> = {
  GRAY: "bg-neutral-400",
  BLUE: "bg-sky-400",
  GREEN: "bg-emerald-400",
  YELLOW: "bg-yellow-400",
  ORANGE: "bg-orange-400",
  RED: "bg-red-400",
  PINK: "bg-pink-400",
  PURPLE: "bg-violet-400",
};

export function ProjectsPanel({ machine, session, params }: PanelProps) {
  const nav = useNavigation();
  const now = useNow(60_000);
  const { noRepo, where, github } = usePanelRepo(session, params);
  const r = useRead<Projects>(machine, session, "projects", noRepo ? undefined : where);
  const data = r.data;
  const open = (p: ProjectRef) => ({ ...where, number: String(p.number) });
  const list = (projects: ProjectRef[]) => (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {projects.map((p) => (
        <li key={p.number}>
          <a
            href={nav.panelHref("project", open(p))}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              nav.openPanel("project", open(p));
            }}
            className="flex gap-2.5 px-3 py-2.5 hover:bg-surface-raised"
          >
            <KanbanSquare className={cn("mt-0.5 size-4 shrink-0", p.closed ? "text-muted-foreground" : "text-emerald-400")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug break-words">{p.title || "（無題）"}</p>
              {p.shortDescription && <p className="mt-0.5 text-xs break-words text-muted-foreground">{p.shortDescription}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">#{p.number}</span>
                <span>{p.items} 件</span>
                {p.closed && <span>閉じている</span>}
                {p.updatedAt && <span>更新 {relativeTime(Date.parse(p.updatedAt), now)}</span>}
              </div>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <PanelFrame
      title="Projects"
      github={github}
      cwd={session.cwd}
      href={github ? `${github.url}/projects` : undefined}
      r={r}
      disabled={!machine.connected || noRepo}
    >
      <PanelRepoTabs session={session} params={params} panel="projects" />
      <div className="space-y-4">
        <Status machine={machine} noRepo={noRepo} error={r.error} loading={!data && r.loading} />
        {data?.missing && <MissingScopeNote missing={data.missing} what="Projects" machine={machine} />}
        {data && !data.missing && (
          <>
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">このリポジトリの Project</h3>
              {data.linked.length ? list(data.linked) : <Empty>このリポジトリにつながった Project はありません。</Empty>}
              {data.linkedTruncated && <Truncated />}
            </section>
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{data.ownerLogin} のほかの Project</h3>
              {data.owner.length ? list(data.owner) : <Empty>ほかの Project はありません。</Empty>}
              {data.ownerTruncated && <Truncated />}
            </section>
          </>
        )}
        <LoadedAt at={r.at} />
      </div>
    </PanelFrame>
  );
}

function Truncated() {
  return (
    <p className="text-xs text-muted-foreground">
      開いているものと閉じたものを、それぞれ新しく更新したものから {PROJECTS_MAX} 件まで表示しています。すべては GitHub で見られます。
    </p>
  );
}

export function BoardPanel({ machine, session, params }: PanelProps) {
  const nav = useNavigation();
  const { where, github } = usePanelRepo(session, params);
  const number = /^\d{1,9}$/.test(params.number ?? "") ? params.number : undefined;
  const r = useRead<Board>(machine, session, "project", number ? { ...where, number } : undefined);
  const board = r.data;
  const field = board?.fields.find((f) => f.id === params.field) ?? board?.fields.find((f) => f.id === board.defaultField) ?? board?.fields[0];
  return (
    <PanelFrame
      title={board?.title || (number ? `Project #${number}` : "Project")}
      github={github}
      cwd={session.cwd}
      href={board?.url || undefined}
      r={r}
      disabled={!machine.connected || !number}
    >
      <button type="button" onClick={() => nav.back({ id: "projects", params: where })} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Projects の一覧
      </button>
      <div className="space-y-3">
        {!number && <p className="text-sm text-red-400">Project の番号が正しくありません。</p>}
        <Status machine={machine} error={r.error} loading={!board && r.loading && Boolean(number)} />
        {board?.missing && <MissingScopeNote missing={board.missing} what="Projects" machine={machine} />}
        {board && !board.missing && (
          <>
            {board.shortDescription && <p className="text-xs text-muted-foreground">{board.shortDescription}</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {board.fields.length > 0 && (
                <label className="inline-flex items-center gap-1.5">
                  列
                  <select
                    value={field?.id ?? ""}
                    onChange={(e) => nav.replacePanel("project", { ...where, number: number ?? "", field: e.target.value })}
                    className="h-7 rounded-md border border-border bg-surface px-2 text-foreground"
                  >
                    {board.fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span>{board.items.length} 件</span>
              {board.closed && <span>閉じている Project</span>}
            </div>
            {board.truncated && <p className="text-xs text-muted-foreground">項目が多いので、先頭から {board.items.length} 件だけ並べています。すべては GitHub で見られます。</p>}
            <Columns board={board} fieldId={field?.id} />
          </>
        )}
        <LoadedAt at={r.at} />
      </div>
    </PanelFrame>
  );
}

/**
 * The board's columns: one per option or iteration of the field (iterations that ended only when they hold items, as
 * GitHub's board shows them), and one for the items without a value (when there are any).
 */
function Columns({ board, fieldId }: { board: Board; fieldId?: string }) {
  const field = board.fields.find((f) => f.id === fieldId);
  const columns: { id: string; name: string; color?: string; title?: string; items: BoardItem[] }[] = field
    ? field.options
        .map((o) => ({
          id: o.id,
          name: o.name,
          color: o.color,
          title: o.startDate ? `${o.name}（${o.startDate} から）` : o.name,
          completed: o.completed,
          items: board.items.filter((i) => i.values[field.id] === o.id),
        }))
        .filter((c) => !c.completed || c.items.length > 0)
    : [];
  const known = new Set(field?.options.map((o) => o.id));
  const rest = board.items.filter((i) => !field || !known.has(i.values[field.id] ?? ""));
  if (rest.length || !field) columns.push({ id: "", name: field ? `${field.name} なし` : "すべて", items: rest });
  if (board.items.length === 0) return <Empty>この Project には項目がありません。</Empty>;
  return (
    // Wider than the panel: it scrolls sideways (the panel's padding stays at both ends).
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex w-max gap-3">
        {columns.map((c) => (
          <section key={c.id || "none"} aria-label={c.name} className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-surface/40">
            <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", c.id ? (OPTION_COLOR[c.color ?? ""] ?? "bg-neutral-400") : "border border-dashed border-muted-foreground")} />
              <span className="min-w-0 flex-1 truncate font-medium" title={c.title ?? c.name}>
                {c.name}
              </span>
              <span className="text-muted-foreground tabular-nums">{c.items.length}</span>
            </header>
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
              {c.items.map((item) => (
                <BoardCard key={item.id} item={item} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ItemIcon({ item }: { item: BoardItem }) {
  const c = "mt-0.5 size-3.5 shrink-0";
  if (item.type === "draft") return <FileText aria-label="下書き" className={cn(c, "text-muted-foreground")} />;
  if (item.type === "redacted") return <Lock aria-label="読めない項目" className={cn(c, "text-muted-foreground")} />;
  if (item.type === "issue") {
    if (item.state === "closed") return <CircleCheck aria-label="閉じた Issue" className={cn(c, "text-violet-400")} />;
    if (item.state === "not_planned") return <CircleSlash aria-label="対応しない Issue" className={cn(c, "text-muted-foreground")} />;
    if (item.state === "duplicate") return <CircleSlash aria-label="重複として閉じた Issue" className={cn(c, "text-muted-foreground")} />;
    return <CircleDot aria-label="Issue" className={cn(c, "text-emerald-400")} />;
  }
  if (item.state === "merged") return <GitMerge aria-label="マージ済みの Pull request" className={cn(c, "text-violet-400")} />;
  if (item.state === "closed") return <GitPullRequestClosed aria-label="閉じた Pull request" className={cn(c, "text-red-400")} />;
  if (item.state === "draft") return <GitPullRequestDraft aria-label="下書きの Pull request" className={cn(c, "text-muted-foreground")} />;
  return <GitPullRequest aria-label="Pull request" className={cn(c, "text-emerald-400")} />;
}

function BoardCard({ item }: { item: BoardItem }) {
  const body = (
    <>
      <div className="flex gap-1.5">
        <ItemIcon item={item} />
        <p className="min-w-0 flex-1 text-xs leading-snug break-words">{item.title || "（無題）"}</p>
      </div>
      {(item.number || item.assignees.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-5 text-[11px] text-muted-foreground">
          {item.number && (
            <span className="tabular-nums">
              {item.repo ? `${item.repo}` : ""}#{item.number}
            </span>
          )}
          {item.assignees.length > 0 && <span className="truncate">{item.assignees.join("、")}</span>}
        </div>
      )}
    </>
  );
  return (
    <li>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-border bg-surface px-2.5 py-2 hover:bg-surface-raised">
          {body}
        </a>
      ) : (
        <div className="rounded-lg border border-border bg-surface px-2.5 py-2">{body}</div>
      )}
    </li>
  );
}
