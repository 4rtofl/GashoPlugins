// The box for a new comment, right under the body.
import { Button } from "../../ui/button.tsx";
import { INPUT, isComposing, leftAfter } from "../../ui/input.ts";
import { useDraft, useItem } from "../context.tsx";
import type { ConversationPart } from "../parts.ts";

function NewComment() {
  const { where, busy, run } = useItem();
  const [draft, setDraft] = useDraft<string>("comment");
  const text = draft ?? "";
  const send = async () => {
    const sent = text;
    // What was typed while it was being sent stays.
    if (await run({ id: "comment", op: "comment", params: { body: sent }, summary: `#${where.number} にコメントする`, done: "コメントしました" })) setDraft((d) => leftAfter(d ?? "", sent) || undefined);
  };
  return (
    <section className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setDraft(e.target.value || undefined)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isComposing(e) && text.trim() && busy === undefined) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder="コメントを書く（Markdown。⌘ + Enter で送る）"
        aria-label="新しいコメント"
        rows={4}
        className={INPUT}
      />
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void send()} disabled={busy !== undefined || !text.trim()} isLoading={busy === "comment"} loadingText="送っています…">
          コメントする
        </Button>
      </div>
    </section>
  );
}

export default { order: 1, UnderBody: NewComment } satisfies ConversationPart;
