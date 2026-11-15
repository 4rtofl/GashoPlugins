// Tells the daemon part what the screen shows of the item (ops/seen.ts), every time the item is read, so that its
// worktree tab counts only what comes after; and, while the screen is open, keeps a number off the tab (web/news.ts).
// It shows nothing.
import { useEffect } from "react";
import { usePluginState, useRequest } from "@gasho/plugin-sdk";
import { marksOf } from "../../../news.ts";
import { readOp } from "../../daemon.ts";
import { OPEN_KEY, SEEN_KEY } from "../../news.ts";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

function Seen() {
  const { machine, where, item } = useItem();
  const key = `${where.repo}#${where.number}`;
  const [, setOpen] = usePluginState<string | undefined>(OPEN_KEY, undefined);
  const [, setSeen] = usePluginState(SEEN_KEY, 0);
  // usePluginState gives a new setter on every render: only the key and the read run the effects.
  useEffect(() => {
    setOpen(key);
    return () => setOpen((o) => (o === key ? undefined : o));
  }, [key]);
  // A call per marks: the item read again with nothing new asks nothing.
  const r = useRequest(readOp(machine, "seen", { repo: where.repo, number: where.number, marks: marksOf(item) }));
  useEffect(() => {
    if (r.at !== undefined) setSeen((n) => n + 1);
  }, [r.at]);
  return null;
}

export default { order: 1000, kinds: ["issues", "pulls"], View: Seen } satisfies ItemSection;
