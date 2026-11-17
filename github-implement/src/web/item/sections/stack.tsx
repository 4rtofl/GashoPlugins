// A pull request's stack as a breadcrumb: the branch it starts from (the default branch), the parents (each one's head
// is the next one's base), this one, and the open pull requests whose base is its head. A pull request opens in the
// worktree's tab. Shown only when there is a parent or a child.
import { GitBranch } from "lucide-react";
import { cn, useNavigation } from "@gasho/plugin-sdk";
import { itemIcon } from "../../tabs.ts";
import { Breadcrumb, type BreadcrumbItem } from "../../ui/breadcrumb.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { Row } from "../row.tsx";
import { useStack, type StackPull } from "../stack.ts";

type Pull = Pick<StackPull, "number" | "title" | "state" | "draft">;

const stateName = (p: Pull): string => (p.state === "merged" ? "マージ済み" : p.state === "closed" ? "閉じた" : p.draft ? "Draft" : "Open");

const iconColor = (p: Pull): string =>
  p.state === "merged" ? "text-violet-600 dark:text-violet-400" : p.state === "closed" ? "text-red-600 dark:text-red-400" : p.draft ? "" : "text-emerald-600 dark:text-emerald-400";

function PullLabel({ pull }: { pull: Pull }) {
  return (
    <>
      <span className="tabular-nums">#{pull.number}</span> <span className="inline-block max-w-48 truncate align-bottom">{pull.title}</span>
    </>
  );
}

function Stack() {
  const { item } = useItem();
  const nav = useNavigation();
  const s = useStack().data;
  if (!s || (s.parents.length === 0 && s.children.length === 0)) return null;

  const crumb = (p: Pull, current = false): BreadcrumbItem => {
    const Icon = itemIcon({ kind: "pulls", ...p });
    const params = { kind: "pulls", number: String(p.number) };
    return {
      key: `#${p.number}`,
      icon: <Icon className={iconColor(p)} />,
      label: <PullLabel pull={p} />,
      title: `#${p.number} ${p.title}（${stateName(p)}）`,
      ...(current ? { current: true } : { href: nav.worktreeHref("item", params), onOpen: () => nav.openWorktreeView("item", params) }),
    };
  };
  const root: BreadcrumbItem = {
    key: "root",
    icon: <GitBranch />,
    label: <span className={cn("font-mono", s.root.gone && "line-through")}>{s.root.name}</span>,
    title: s.root.gone ? `${s.root.name}（消されたブランチ）` : s.root.name,
  };
  const items: (BreadcrumbItem | BreadcrumbItem[])[] = [root, ...s.parents.map((p) => crumb(p)), crumb(item, true)];
  if (s.children.length > 0) items.push(s.children.map((p) => crumb(p)));

  return (
    <Row label="親と子">
      <Breadcrumb label={`#${item.number} の親と子の Pull request`} items={items} className="-ml-2 min-w-0 flex-1" />
    </Row>
  );
}

export default { order: 33, kinds: ["pulls"], place: "row", View: Stack } satisfies ItemSection;
