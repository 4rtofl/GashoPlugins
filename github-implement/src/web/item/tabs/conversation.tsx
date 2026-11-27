// The conversation, as GitHub's new pull request page shows it: the body at the top, under it what the files of
// conversation/ put there (the box for a new comment), and then their comments, reviews and changes of state on a
// timeline, newest first.
import { MessagesSquare } from "lucide-react";
import { Timeline } from "../../ui/timeline.tsx";
import { partsOf, type ConversationEntry, type ConversationPart, type ItemTab } from "../parts.ts";

const PARTS = partsOf(import.meta.glob<{ default: ConversationPart }>("../conversation/*.tsx", { eager: true }));

function Conversation() {
  // Every part's hook, in the same order on every render.
  const entries = PARTS.flatMap((p) => (p.useEntries?.() ?? []).map((e): [ConversationEntry, number] => [e, p.order]));
  entries.sort(([a, ao], [b, bo]) => b.at.localeCompare(a.at) || ao - bo);
  const pinned = (pin?: ConversationEntry["pin"]) => entries.filter(([e]) => e.pin === pin).map(([e]) => e);
  const rest = [...pinned(undefined), ...pinned("bottom")];
  return (
    <div className="space-y-4">
      <Timeline label="本文" nodes={false} entries={pinned("top")} />
      {PARTS.map((p, i) => p.UnderBody && <p.UnderBody key={i} />)}
      {rest.length > 0 && <Timeline label="会話" entries={rest} />}
    </div>
  );
}

export default { id: "conversation", label: "会話", order: 10, kinds: ["issues", "pulls"], icon: MessagesSquare, View: Conversation } satisfies ItemTab;
