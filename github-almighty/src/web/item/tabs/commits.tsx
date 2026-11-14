// A pull request's commits, oldest first, each with its hash to copy and a link to it on GitHub.
import { GitCommit } from "lucide-react";
import { RelativeTime } from "@gasho/plugin-sdk";
import { CopyHash, Timeline } from "../../ui/timeline.tsx";
import { useItem } from "../context.tsx";
import type { ItemTab } from "../parts.ts";

function Commits() {
  const { item, now } = useItem();
  const commits = item.commits ?? [];
  if (commits.length === 0) return <p className="text-sm text-muted-foreground">コミットはありません。</p>;
  return (
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
  );
}

export default { id: "commits", label: "コミット", order: 20, kinds: ["pulls"], icon: GitCommit, badge: (item) => item.commits?.length, View: Commits } satisfies ItemTab;
