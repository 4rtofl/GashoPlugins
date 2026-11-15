// The projects (GitHub Projects) the issue or pull request is in, each with the values of its fields: a single select,
// a date, a number and a text can be changed (an iteration only shows), an × takes it out of the project, and a picker
// puts it in another. An Undo Toast puts each change back; one taken out comes back with the values it held. They are
// read apart from the item (the operation "projects"), as gh needs the scope "project" for them.
import { Check, Table2, X } from "lucide-react";
import { useState } from "react";
import { cn, Popover, useRequest } from "@gasho/plugin-sdk";
import type { ProjectField, ProjectItem, ProjectRef, ProjectsRead, ProjectValue } from "../../../daemon/ops/projects.ts";
import { readOp } from "../../daemon.ts";
import { useRefreshOptions } from "../../tabs.ts";
import { Button } from "../../ui/button.tsx";
import { INPUT } from "../../ui/input.ts";
import { Skeleton } from "../../ui/skeleton.tsx";
import { useAfterChange, useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { Picker } from "../picker.tsx";

/** GitHub's colors of a single select's options. */
const COLORS: Record<string, string> = { GRAY: "#8c959f", BLUE: "#218bff", GREEN: "#2da44e", YELLOW: "#d4a72c", ORANGE: "#e16f24", RED: "#fa4549", PINK: "#e85aad", PURPLE: "#a475f9" };

function Dot({ color }: { color?: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[color ?? ""] ?? COLORS.GRAY }} />;
}

/** A value as the screen shows it. */
function shown(f: ProjectField): string | undefined {
  const v = f.value;
  if (!v) return undefined;
  if ("text" in v) return v.text;
  if ("number" in v) return v.number.toLocaleString();
  if ("date" in v) return v.date.replaceAll("-", "/");
  if ("singleSelectOptionId" in v) return f.valueName ?? f.options?.find((o) => o.id === v.singleSelectOptionId)?.name;
  return f.valueName;
}

function Projects() {
  const { machine, where, busy, run } = useItem();
  const r = useRequest<ProjectsRead>(readOp(machine, "projects", { repo: where.repo, number: where.number }), useRefreshOptions());
  useAfterChange(r.reload);
  const read = r.data && "contentId" in r.data ? r.data : undefined;
  const add = (p: ProjectRef, contentId: string) =>
    void run({
      id: `project+${p.id}`,
      op: "project",
      params: { action: "add", projectId: p.id, contentId },
      summary: `#${where.number} を Project「${p.title}」に足す`,
      done: `Project「${p.title}」に足しました`,
      undo: { op: "project", params: { action: "remove", projectId: p.id, contentId }, summary: `#${where.number} を Project「${p.title}」から外す` },
    });
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <span className="w-10 shrink-0 py-1.5 text-muted-foreground">Project</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        {read?.items.map((i) => (
          <ProjectBox key={i.id} entry={i} contentId={read.contentId} />
        ))}
        <div className="flex min-h-7 flex-wrap items-center gap-1.5">
          {!r.data && !r.error && <Skeleton className="h-6 w-32 rounded-full" />}
          {r.data && "noScope" in r.data && (
            <span className="text-muted-foreground">
              gh のログインに Projects の権限がありません。working server で <code className="rounded bg-surface-raised px-1 py-0.5 font-mono">gh auth refresh -s project</code>{" "}
              を実行し、ブラウザーで許可すると、ここで見て変えられます。
            </span>
          )}
          {r.error && <span className="text-red-600 dark:text-red-400">Project を読めませんでした：{r.error}</span>}
          {read && read.items.length === 0 && <span className="text-muted-foreground">なし</span>}
          {read && (
            <Picker
              label="Project に足す"
              disabled={busy !== undefined}
              choices={read.choices.map((p) => ({
                key: p.id,
                name: p.title,
                text: (
                  <span className="min-w-0 truncate">
                    {p.title} <span className="text-muted-foreground">#{p.number}</span>
                  </span>
                ),
                pick: () => add(p, read.contentId),
              }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectBox({ entry, contentId }: { entry: ProjectItem; contentId: string }) {
  const { where, busy, run } = useItem();
  const { project } = entry;
  const id = `project-${project.id}`;
  // What an Undo Toast sets again when it puts the item back.
  const values = entry.fields.flatMap((f) => (f.value ? [{ fieldId: f.id, value: f.value }] : []));
  const remove = () =>
    void run({
      id,
      op: "project",
      params: { action: "remove", projectId: project.id, contentId },
      summary: `#${where.number} を Project「${project.title}」から外す`,
      done: `Project「${project.title}」から外しました`,
      undo: { op: "project", params: { action: "add", projectId: project.id, contentId, values }, summary: `#${where.number} を Project「${project.title}」に戻す` },
    });
  return (
    <section aria-label={`Project「${project.title}」`} className="rounded-xl border border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Table2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <a href={project.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-foreground/90 hover:underline" title={project.title}>
          {project.title}
        </a>
        <span className="shrink-0 text-muted-foreground">#{project.number}</span>
        <span className="flex-1" />
        {project.canUpdate && (
          <Button variant="ghost" size="icon" onClick={remove} disabled={busy !== undefined} isLoading={busy === id} aria-label={`Project「${project.title}」から外す`} title="この Project から外す">
            <X />
          </Button>
        )}
      </div>
      {entry.fields.length > 0 && (
        <dl className="mt-1 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-center gap-x-3">
          {entry.fields.map((f) => (
            <div key={f.id} className="contents">
              <dt className="max-w-40 truncate text-muted-foreground" title={f.name}>
                {f.name}
              </dt>
              <dd className="min-w-0">
                <FieldValue project={project} itemId={entry.id} field={f} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function ValueText({ field }: { field: ProjectField }) {
  const text = shown(field);
  if (text === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {field.type === "single_select" && <Dot color={field.options?.find((o) => field.value && "singleSelectOptionId" in field.value && o.id === field.value.singleSelectOptionId)?.color} />}
      <span className="min-w-0 truncate text-foreground/90">{text}</span>
    </span>
  );
}

/** A field's value; a press opens what changes it: the options of a single select, a box for the others. */
function FieldValue({ project, itemId, field }: { project: ProjectRef; itemId: string; field: ProjectField }) {
  const { where, busy, run } = useItem();
  const [open, setOpen] = useState(false);
  if (!project.canUpdate || field.type === "iteration") {
    return (
      <span className="flex h-7 min-w-0 items-center px-2" title={shown(field)}>
        <ValueText field={field} />
      </span>
    );
  }
  const id = `field-${itemId}-${field.id}`;
  const target = { projectId: project.id, itemId, fieldId: field.id };
  const set = (to: ProjectValue | undefined, text: string) => {
    setOpen(false);
    void run({
      id,
      op: "project",
      params: { ...target, ...(to ? { action: "set", value: to } : { action: "clear" }) },
      summary: `#${where.number} の Project「${project.title}」の「${field.name}」を${to ? `「${text}」にする` : "空にする"}`,
      done: `「${field.name}」を${to ? `「${text}」にしました` : "空にしました"}`,
      undo: {
        op: "project",
        params: { ...target, ...(field.value ? { action: "set", value: field.value } : { action: "clear" }) },
        summary: `#${where.number} の Project「${project.title}」の「${field.name}」を戻す`,
      },
    });
  };
  return (
    <Popover
      label={`「${field.name}」を変える`}
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-64 p-1"
      trigger={
        <Button
          variant="ghost"
          size="xs"
          disabled={busy !== undefined}
          isLoading={busy === id}
          aria-label={`${field.name}：${shown(field) ?? "なし"}。変える`}
          title={shown(field)}
          className="max-w-full justify-start"
        >
          <ValueText field={field} />
        </Button>
      }
    >
      {field.type === "single_select" ? <Options field={field} onPick={set} onClose={() => setOpen(false)} /> : <ValueBox field={field} onSave={set} />}
    </Popover>
  );
}

function Options({ field, onPick, onClose }: { field: ProjectField; onPick: (to: ProjectValue | undefined, text: string) => void; onClose: () => void }) {
  const current = field.value && "singleSelectOptionId" in field.value ? field.value.singleSelectOptionId : undefined;
  const row = "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised";
  return (
    <div className="max-h-64 overflow-y-auto">
      {(field.options ?? []).map((o) => (
        <button key={o.id} type="button" onClick={() => (o.id === current ? onClose() : onPick({ singleSelectOptionId: o.id }, o.name))} className={row}>
          <Dot color={o.color} />
          <span className="min-w-0 flex-1 truncate">{o.name}</span>
          {o.id === current && <Check aria-label="いまの値" className="size-3.5 shrink-0" />}
        </button>
      ))}
      {field.options?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">選択肢がありません。</p>}
      {current && (
        <button type="button" onClick={() => onPick(undefined, "")} className={cn(row, "mt-1 border-t border-border text-muted-foreground")}>
          空にする
        </button>
      )}
    </div>
  );
}

/** The value a box holds, or undefined while it holds none that GitHub takes. */
function parse(type: ProjectField["type"], draft: string): ProjectValue | undefined {
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(draft) ? { date: draft } : undefined;
  if (type === "number") return draft.trim() && Number.isFinite(Number(draft)) ? { number: Number(draft) } : undefined;
  return draft.trim() ? { text: draft } : undefined;
}

function ValueBox({ field, onSave }: { field: ProjectField; onSave: (to: ProjectValue | undefined, text: string) => void }) {
  const v = field.value;
  const [draft, setDraft] = useState(v ? String(Object.values(v)[0]) : "");
  const to = parse(field.type, draft);
  const same = to !== undefined && v !== undefined && Object.values(to)[0] === Object.values(v)[0];
  return (
    <form
      className="space-y-2 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (to && !same) onSave(to, field.type === "date" ? draft.replaceAll("-", "/") : draft);
      }}
    >
      <input
        autoFocus
        type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        {...(field.type === "number" ? { step: "any" } : {})}
        // Without a max, Chrome takes six digits for the year and does not move on to the month.
        {...(field.type === "date" ? { max: "9999-12-31" } : {})}
        {...(field.type === "text" ? { maxLength: 1024 } : {})}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={field.name}
        className={cn(INPUT, "py-1.5 text-xs")}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="xs" disabled={!to || same}>
          保存する
        </Button>
        {v && (
          <Button size="xs" onClick={() => onSave(undefined, "")}>
            空にする
          </Button>
        )}
      </div>
    </form>
  );
}

export default { order: 35, kinds: ["issues", "pulls"], View: Projects } satisfies ItemSection;
