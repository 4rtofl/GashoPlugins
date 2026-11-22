// A pull request's reviewers and where each stands (waiting, approved, changes requested, commented), a picker that
// asks one more and an × that takes a request back (an Undo Toast can put either back), and the form that sends a
// review: a comment, an approval or a request for changes. On one's own pull request, GitHub takes only a comment.
import { CircleAlert, CircleCheck, CircleSlash, Clock, MessageSquareText, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { cn, useRequest } from "@gasho/plugin-sdk";
import type { GitHubReviewer } from "../../../daemon/detail/reviewers.ts";
import type { ReviewEvent } from "../../../daemon/ops/review.ts";
import type { RepoMeta } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { INPUT, isComposing, leftAfter } from "../../ui/input.ts";
import { useDraft, useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { assignableSearch, Picker, type Choice } from "../picker.tsx";

const STATE: Record<GitHubReviewer["state"], { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  requested: { label: "待ち", tone: "neutral", icon: Clock },
  approved: { label: "承認", tone: "success", icon: CircleCheck },
  changes_requested: { label: "修正を依頼", tone: "warning", icon: CircleAlert },
  commented: { label: "コメント", tone: "neutral", icon: MessageSquareText },
  dismissed: { label: "取り消し", tone: "neutral", icon: CircleSlash },
};

const EVENTS: { id: ReviewEvent; label: string; hint: string; summary: string; done: string }[] = [
  { id: "comment", label: "コメント", hint: "承認も修正の依頼もせずに、意見を送る", summary: "レビューのコメントを送る", done: "レビューのコメントを送りました" },
  { id: "approve", label: "承認（Approve）", hint: "このままマージしてよいと伝える", summary: "承認のレビューを送る", done: "承認しました" },
  { id: "request_changes", label: "修正を依頼（Request changes）", hint: "マージの前に直すところがあると伝える", summary: "修正を依頼するレビューを送る", done: "修正を依頼しました" },
];

/** The review being written: its kind and its body. */
interface Review {
  event: ReviewEvent;
  body: string;
}

function Reviewers() {
  const { machine, item, where, busy, run } = useItem();
  const meta = useRequest<RepoMeta>(readOp(machine, "meta", { repo: where.repo }), { staleSeconds: 300 });
  const [review, setReview] = useDraft<Review>("review");
  const reviewers = item.reviewers ?? [];
  const open = item.state === "open";
  if (!open && reviewers.length === 0) return null;
  const id = `#${where.number}`;
  const waiting = new Set(reviewers.filter((r) => r.state === "requested").map((r) => r.name));
  const change = (name: string, add: boolean) =>
    void run({
      id: `reviewer${add ? "+" : "-"}${name}`,
      op: "reviewers",
      params: add ? { add: [name] } : { remove: [name] },
      summary: add ? `${id} のレビューを ${name} に頼む` : `${id} の ${name} へのレビューの依頼を取り消す`,
      done: add ? `${name} にレビューを頼みました` : `${name} へのレビューの依頼を取り消しました`,
      undo: add
        ? { op: "reviewers", params: { remove: [name] }, summary: `${id} の ${name} へのレビューの依頼を取り消す` }
        : { op: "reviewers", params: { add: [name] }, summary: `${id} のレビューを ${name} に頼み直す` },
    });
  // The author cannot be asked; one who reviewed can be asked again.
  const choice = (a: string): Choice | undefined => (a === item.author || waiting.has(a) ? undefined : { key: a, name: a, text: <span>{a}</span>, pick: () => change(a, true) });
  const choices = meta.data?.assignable.flatMap((a) => choice(a) ?? []);
  const search = meta.data?.assignableMore ? assignableSearch(machine, where.repo, choice) : undefined;
  const own = meta.data?.me !== undefined && meta.data.me === item.author;
  return (
    <section aria-label="レビュアー" className="space-y-2 rounded-xl border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground">レビュアー</span>
        {reviewers.map((r) => {
          const s = STATE[r.state];
          const Icon = s.icon;
          return (
            <Badge
              key={r.name}
              variant="outline"
              tone={s.tone}
              icon={<Icon />}
              {...(open &&
                r.state === "requested" && {
                  onRemove: () => change(r.name, false),
                  removeLabel: `${r.name} へのレビューの依頼を取り消す`,
                  removeDisabled: busy !== undefined,
                })}
            >
              {r.name}
              <span className="font-normal opacity-80">{s.label}</span>
            </Badge>
          );
        })}
        {reviewers.length === 0 && <span className="text-muted-foreground">なし</span>}
        {open && <Picker label="レビューを頼む" error={meta.error} disabled={busy !== undefined} choices={choices} {...(search && { search })} />}
        {open && !review && (
          <Button size="xs" className="ml-auto" leftIcon={<MessageSquareText />} onClick={() => setReview({ event: "comment", body: "" })}>
            レビューする
          </Button>
        )}
      </div>
      {open && review && <ReviewForm own={own} review={review} onChange={setReview} />}
    </section>
  );
}

function ReviewForm({ own, review, onChange }: { own: boolean; review: Review; onChange: (next: Review | undefined | ((prev: Review | undefined) => Review | undefined)) => void }) {
  const { where, busy, run } = useItem();
  const name = useId();
  const { body } = review;
  const event = own ? "comment" : review.event;
  const ready = busy === undefined && (event === "approve" || body.trim() !== "");
  const close = () => onChange(undefined);
  const send = async () => {
    const e = EVENTS.find((x) => x.id === event) ?? EVENTS[0]!;
    // What was typed while it was being sent stays in the form; the form closes when nothing was.
    if (await run({ id: "review", op: "review", params: { event, body }, summary: `#${where.number} に${e.summary}`, done: e.done })) {
      onChange((r) => {
        const left = r ? leftAfter(r.body, body) : "";
        return r && left ? { ...r, body: left } : undefined;
      });
    }
  };
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <fieldset className="space-y-0.5">
        <legend className="sr-only">レビューの種類</legend>
        {EVENTS.map((e) => {
          const off = own && e.id !== "comment";
          return (
            <label key={e.id} className={cn("flex items-start gap-2 rounded-md px-1.5 py-1", off ? "opacity-50" : "cursor-pointer hover:bg-surface-hover")}>
              <input type="radio" name={name} value={e.id} checked={event === e.id} disabled={off || busy !== undefined} onChange={() => onChange({ ...review, event: e.id })} className="mt-0.5 accent-current" />
              <span>
                <span className="font-medium text-foreground">{e.label}</span>
                <span className="block text-muted-foreground">{e.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {own && <p className="text-muted-foreground">自分の Pull request なので、承認と修正の依頼は選べません（GitHub と同じ）。</p>}
      <textarea
        value={body}
        onChange={(e) => onChange({ ...review, body: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isComposing(e) && ready) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={event === "approve" ? "レビューの本文（Markdown。承認では省ける。⌘ + Enter で送る）" : "レビューの本文（Markdown。⌘ + Enter で送る）"}
        aria-label="レビューの本文"
        rows={4}
        className={INPUT}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={close} disabled={busy === "review"}>
          やめる
        </Button>
        <Button variant="primary" onClick={() => void send()} disabled={!ready} isLoading={busy === "review"} loadingText="送っています…">
          レビューを送る
        </Button>
      </div>
    </div>
  );
}

export default { order: 45, kinds: ["pulls"], View: Reviewers } satisfies ItemSection;
