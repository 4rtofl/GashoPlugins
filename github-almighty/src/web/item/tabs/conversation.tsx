// The conversation: what the files of conversation/ show (the body, comments, reviews, changes of state), oldest first
// on a timeline, and below it what they put there (the box for a new comment).
import { MessagesSquare } from "lucide-react";
import { Timeline } from "../../ui/timeline.tsx";
import { partsOf, type ConversationEntry, type ConversationPart, type ItemTab } from "../parts.ts";

const PARTS = partsOf(import.meta.glob<{ default: ConversationPart }>("../conversation/*.tsx", { eager: true }));

function Conversation() {
  // Every part's hook, in the same order on every render.
  const entries = PARTS.flatMap((p) => (p.useEntries?.() ?? []).map((e): [ConversationEntry, number] => [e, p.order]));
  entries.sort(([a, ao], [b, bo]) => a.at.localeCompare(b.at) || ao - bo);
  return (
    <div className="space-y-4">
      <Timeline label="会話" entries={entries.map(([e]) => e)} />
      {PARTS.map((p, i) => p.End && <p.End key={i} />)}
    </div>
  );
}

export default { id: "conversation", label: "会話", order: 10, kinds: ["issues", "pulls"], icon: MessagesSquare, View: Conversation } satisfies ItemTab;
