// A pull request's commits, oldest first, each with its hash to copy and a link to it on GitHub.
import { GitCommit } from "lucide-react";
import { RelativeTime } from "@gasho/plugin-sdk";
import { Alert } from "../../ui/alert.tsx";
import { CopyHash, Timeline } from "../../ui/timeline.tsx";
import { useItem } from "../context.tsx";
import type { ItemTab } from "../parts.ts";

/** GitHub gives a pull request's first 250 commits and no more (daemon/detail/commits.ts). */
const COMMITS_MAX = 250;

function Commits() {
  const { item, now } = useItem();
  const commits = item.commits ?? [];
  if (commits.length === 0) return <p className="text-sm text-muted-foreground">コミットはありません。</p>;
  return (
    <>
      {commits.length >= COMMITS_MAX && (
        <Alert>
          GitHub が渡すのは、古いほうから {COMMITS_MAX} 件までです。それより新しいコミットは
          <a href={`${item.url}/commits`} target="_blank" rel="noreferrer" className="mx-0.5 underline">
            GitHub
          </a>
          で読めます。
        </Alert>
      )}
      <Timeline
        label="コミット"
        entries={commits.map((c) => ({
          key: c.oid,
          icon: GitCommit,
          title: (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <a href={`${item.url}/commits/${c.oid}`} target="_blank" rel="noreferrer" className="text-foreground/90 hover:underline">
                {c.headline || c.oid.slice(0, 7)}
              </a>
              <CopyHash hash={c.oid} />
              {c.author && <span>{c.author}</span>}
            </span>
          ),
          ...(c.committedAt ? { time: <RelativeTime at={c.committedAt} now={now} /> } : {}),
        }))}
      />
    </>
  );
}

export default { id: "commits", label: "コミット", order: 20, kinds: ["pulls"], icon: GitCommit, badge: (item) => (item.commits && item.commits.length >= COMMITS_MAX ? `${COMMITS_MAX}+` : item.commits?.length), View: Commits } satisfies ItemTab;
