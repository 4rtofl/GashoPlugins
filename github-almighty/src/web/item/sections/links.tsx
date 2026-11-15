// What a pull request closes when it is merged, and what closes an issue (GitHub's "Development"). A pull request's
// screen links issues by hand from a list of the open ones, and takes those links off with an ×; a link its body makes
// ("Closes #12") has no ×, as only changing the body takes it off. An issue's screen shows the pull requests that close
// it. They are read apart from the item (the operation "links"); an Undo Toast can put each change back.
import type { ReactNode } from "react";
import { useRequest } from "@gasho/plugin-sdk";
import type { ItemLinks, LinkedIssue, LinkedPull } from "../../../daemon/ops/links.ts";
import { readOp } from "../../daemon.ts";
import { itemIcon, NOT_PLANNED_ICON, useRefreshOptions } from "../../tabs.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { useAfterChange, useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { Picker } from "../picker.tsx";
import { Row } from "../row.tsx";

const name = (l: { number: number; repo?: string }) => `${l.repo ?? ""}#${l.number}`;

function LinkBadge({ link, tone, icon, note, onRemove, removeDisabled }: { link: LinkedIssue | LinkedPull; tone: BadgeTone; icon: ReactNode; note?: string; onRemove?: () => void; removeDisabled?: boolean }) {
  return (
    <Badge variant="outline" tone={tone} icon={icon} title={note} {...(onRemove && { onRemove, removeLabel: `${name(link)} を外す`, removeDisabled })}>
      <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline">
        <span className="shrink-0 tabular-nums">{name(link)}</span>
        <span className="max-w-[14rem] truncate font-normal text-muted-foreground">{link.title}</span>
      </a>
      {note && <span className="shrink-0 font-normal text-muted-foreground">本文</span>}
    </Badge>
  );
}

function issueLook(i: LinkedIssue): { tone: BadgeTone; Icon: ReturnType<typeof itemIcon> } {
  if (i.state === "open") return { tone: "success", Icon: itemIcon({ kind: "issues", state: "open" }) };
  return i.stateReason === "not_planned" ? { tone: "neutral", Icon: NOT_PLANNED_ICON } : { tone: "merged", Icon: itemIcon({ kind: "issues", state: "closed" }) };
}

const PULL_TONE: Record<LinkedPull["state"], BadgeTone> = { open: "success", closed: "danger", merged: "merged" };

function Links() {
  const { machine, item, where, busy, run } = useItem();
  const r = useRequest<ItemLinks>(readOp(machine, "links", { repo: where.repo, kind: where.kind, number: where.number }), useRefreshOptions());
  useAfterChange(r.reload);
  const pr = `#${where.number}`;

  if (item.kind === "issues") {
    const pulls = r.data?.closedBy;
    return (
      <Row label="閉じる Pull request">
        {pulls?.map((p) => {
          const Icon = itemIcon({ kind: "pulls", state: p.state, ...(p.draft ? { draft: true } : {}) });
          return <LinkBadge key={name(p)} link={p} tone={p.state === "open" && p.draft ? "neutral" : PULL_TONE[p.state]} icon={<Icon />} />;
        })}
        {pulls?.length === 0 && <span className="text-muted-foreground">なし</span>}
        {r.error && <span className="text-red-500 dark:text-red-400">読めませんでした：{r.error}</span>}
      </Row>
    );
  }

  const closes = r.data?.closes;
  const editable = item.state === "open";
  const link = (n: number, linked: boolean) =>
    void run({
      id: `link${linked ? "+" : "-"}${n}`,
      op: "link-issue",
      params: { issue: n, linked },
      summary: linked ? `${pr} が閉じる Issue に #${n} を足す` : `${pr} が閉じる Issue から #${n} を外す`,
      done: linked ? `閉じる Issue に #${n} を足しました` : `閉じる Issue から #${n} を外しました`,
      undo: { op: "link-issue", params: { issue: n, linked: !linked }, summary: linked ? `${pr} が閉じる Issue から #${n} を外す` : `${pr} が閉じる Issue に #${n} を足し直す` },
    });
  return (
    <Row label="閉じる Issue">
      {closes?.map((i) => {
        const { tone, Icon } = issueLook(i);
        const removable = editable && i.manual && !i.keyword && !i.repo;
        return (
          <LinkBadge
            key={name(i)}
            link={i}
            tone={tone}
            icon={<Icon />}
            {...(i.keyword && { note: `本文かコミットの「Closes ${name(i)}」で紐づいています。外すには、そこから消してください。` })}
            {...(removable && { onRemove: () => link(i.number, false), removeDisabled: busy !== undefined })}
          />
        );
      })}
      {closes?.length === 0 && <span className="text-muted-foreground">なし</span>}
      {r.error && <span className="text-red-500 dark:text-red-400">読めませんでした：{r.error}</span>}
      {editable && (
        <Picker
          label="閉じる Issue を足す"
          error={r.error}
          disabled={busy !== undefined}
          choices={r.data?.open
            ?.filter((o) => !closes?.some((c) => !c.repo && c.number === o.number))
            .map((o) => ({
              key: String(o.number),
              name: `#${o.number} ${o.title}`,
              text: (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-muted-foreground tabular-nums">#{o.number}</span>
                  <span className="truncate">{o.title}</span>
                </span>
              ),
              pick: () => link(o.number, true),
            }))}
        />
      )}
    </Row>
  );
}

export default { order: 37, kinds: ["issues", "pulls"], place: "row", View: Links } satisfies ItemSection;
