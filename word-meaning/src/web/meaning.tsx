// What shows in Gasho's popup by a word selected in one of Claude's answers: a button, and once it is pressed the
// meaning of the word in the text around it, from the daemon part (`meaning`).
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { useRequest, type AnswerSelection, type AnswerSelectionProps } from "@gasho/plugin-sdk";
import { CONTEXT, type Meaning, type MeaningParams } from "../word.ts";

/** What `meaning` gets for a selection: the word, and as much of the answer around it as the setting can ask for. */
export const paramsOf = ({ text, answer, start, end }: AnswerSelection): MeaningParams => ({
  word: text,
  before: answer.slice(Math.max(0, start - CONTEXT.max), start),
  after: answer.slice(end, end + CONTEXT.max),
});

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none transition-colors hover:bg-accent " +
  "hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function WordMeaning(props: AnswerSelectionProps) {
  const [asked, setAsked] = useState(false);
  const { data, error, loading, reload } = useRequest<Meaning>(
    asked ? { machine: props.machine.id, method: "meaning", params: paramsOf(props) } : undefined,
    // The meaning of a word in the same text does not change: selecting it again shows it at once.
    { staleSeconds: 24 * 60 * 60 },
  );

  if (!asked) {
    return (
      <button type="button" className={BUTTON} onClick={() => setAsked(true)}>
        <BookOpen className="size-3.5 text-muted-foreground" aria-hidden />
        意味を調べる
      </button>
    );
  }

  if (data) {
    return (
      <div className="flex flex-col gap-0.5 px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">{props.text}</span>
        <p className="leading-relaxed">{data.meaning}</p>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="flex flex-col items-start gap-1 px-2 py-1">
        <p className="text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
        <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={reload}>
          もう一度
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground" role="status">
      <BookOpen className="size-3.5 animate-pulse" aria-hidden />
      意味を調べています…
    </div>
  );
}
