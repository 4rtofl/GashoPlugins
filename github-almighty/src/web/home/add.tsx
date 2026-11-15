// The box of the "GitHub" tab that adds an issue or pull request to the worktree: by its number, its GitHub URL, or
// words of its title, which list the repository's matches to pick from (↑ ↓ and Enter, or a click).
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { cn, useRequest } from "@gasho/plugin-sdk";
import type { ItemSummary } from "../../types.ts";
import { readOp } from "../daemon.ts";
import { numberFrom } from "../number.ts";
import { itemLook } from "../tabs.ts";
import { Alert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";

/** How long typing pauses before the words are searched: every search takes a point of GitHub's hourly limit. */
const SEARCH_AFTER_MS = 400;

export function AddBox({ machine, repo, has, busy, adding, onAdd }: { machine: string; repo: string; has: Set<number>; busy: boolean; adding: boolean; onAdd: (number: number) => Promise<string | undefined> }) {
  const [text, setText] = useState("");
  const [words, setWords] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string>();
  const list = useId();
  const number = numberFrom(text, repo);
  const typed = text.trim();
  useEffect(() => {
    if (number !== undefined || typed.length < 2) {
      setWords("");
      return;
    }
    const timer = setTimeout(() => setWords(typed), SEARCH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [typed, number]);
  const found = useRequest<ItemSummary[]>(words ? readOp(machine, "search", { repo, query: words }) : undefined, { staleSeconds: 60 });
  const results = words && number === undefined ? found.data : undefined;
  const choice = results?.[Math.min(active, results.length - 1)];
  useEffect(() => setActive(0), [words]);

  const add = async (n: number) => {
    setError(undefined);
    const failed = await onAdd(n);
    if (failed) setError(failed);
    else setText("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (number !== undefined) void add(number);
    else if (choice && !has.has(choice.number)) void add(choice.number);
    else if (!words) setError(`番号（17 や #17）、${repo} の Issue や Pull request の URL、題の語（2 文字から）を入れてください。`);
  };

  const move = (e: KeyboardEvent) => {
    if (!results?.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    setActive((a) => (Math.min(a, results.length - 1) + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
  };

  const optionId = (n: number) => `${list}-${n}`;
  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
          onKeyDown={move}
          placeholder="番号・URL・題の語（例: 17、ログイン）"
          aria-label="worktree に足す Issue や Pull request"
          role="combobox"
          aria-expanded={Boolean(results?.length)}
          aria-controls={list}
          aria-autocomplete="list"
          {...(choice ? { "aria-activedescendant": optionId(choice.number) } : {})}
          className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
        />
        <Button type="submit" variant="primary" disabled={busy || !typed || (number === undefined && (!choice || has.has(choice.number)))} isLoading={adding} loadingText="確かめています…">
          worktree に足す
        </Button>
      </form>
      {words && number === undefined && (
        <div className="overflow-hidden rounded-xl border border-border">
          {found.error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{found.error}</p>}
          {!results && !found.error && <p className="px-3 py-2 text-xs text-muted-foreground">「{words}」を題から探しています…</p>}
          {results?.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">題に「{words}」がある Issue や Pull request はありません。</p>}
          <ul id={list} role="listbox" aria-label={`題に「${words}」がある Issue と Pull request`} className="divide-y divide-border">
            {results?.map((i) => {
              const { ColoredIcon } = itemLook(i);
              const there = has.has(i.number);
              return (
                <li
                  key={i.number}
                  id={optionId(i.number)}
                  role="option"
                  aria-selected={i === choice}
                  aria-disabled={there}
                  onMouseEnter={() => setActive(results.indexOf(i))}
                  onClick={() => !there && !busy && void add(i.number)}
                  className={cn("flex items-center gap-2 px-3 py-2 text-sm", there ? "text-muted-foreground" : "cursor-pointer", i === choice && "bg-surface-raised")}
                >
                  <ColoredIcon className="size-4 shrink-0" />
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{i.number}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{there ? "足してあります" : i.kind === "pulls" ? "Pull request" : "Issue"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
