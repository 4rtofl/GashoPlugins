// ⌘K: another tab of the screen (コミット, チェック, …), and the box for a new comment under the body.
import { MessageSquarePlus } from "lucide-react";
import { usePluginState } from "@gasho/plugin-sdk";
import type { PaletteCommand } from "../../palette.tsx";
import { useItem } from "../context.tsx";
import type { ItemCommands } from "../palette.tsx";
import { partsOf, type ItemTab } from "../parts.ts";

const TABS = partsOf(import.meta.glob<{ default: ItemTab }>("../tabs/*.tsx", { eager: true }));

/** Focuses the element once it is there: a tab's content comes in after the old one has gone (AnimatedTabs). */
function focusWhenShown(selector: string): void {
  const until = Date.now() + 2000;
  const tick = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "center" });
    } else if (Date.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function useTabCommands(): PaletteCommand[] {
  const { item, where } = useItem();
  const tabs = TABS.filter((t) => t.kinds.includes(item.kind));
  // The key and the first value of view.tsx, which shows the tab chosen.
  const [chosen, setChosen] = usePluginState<string>(`tab:${where.repo}#${where.number}`, tabs[0]?.id ?? "");
  const shown = tabs.find((t) => t.id === chosen) ?? tabs[0];
  return [
    {
      id: "comment",
      label: "コメントを書く",
      icon: MessageSquarePlus,
      keywords: "comment reply",
      run: () => {
        setChosen("conversation");
        focusWhenShown('textarea[aria-label="新しいコメント"]');
      },
    },
    ...tabs
      .filter((t) => t !== shown)
      .map((t): PaletteCommand => ({ id: `tab-${t.id}`, label: `「${t.label}」のタブを開く`, ...(t.icon ? { icon: t.icon } : {}), hint: "タブ", keywords: t.id, run: () => setChosen(t.id) })),
  ];
}

export default { order: 30, useCommands: useTabCommands } satisfies ItemCommands;
