// The box for a new comment, at the end of the conversation.
import { useState } from "react";
import { Button } from "../../ui/button.tsx";
import { INPUT } from "../../ui/input.ts";
import { useItem } from "../context.tsx";
import type { ConversationPart } from "../parts.ts";

function NewComment() {
  const { where, busy, run } = useItem();
  const [text, setText] = useState("");
  const send = async () => {
    if (await run({ id: "comment", op: "comment", params: { body: text }, summary: `#${where.number} にコメントする`, done: "コメントしました" })) setText("");
  };
  return (
    <section className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && busy === undefined) {
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

export default { order: 1000, End: NewComment } satisfies ConversationPart;
