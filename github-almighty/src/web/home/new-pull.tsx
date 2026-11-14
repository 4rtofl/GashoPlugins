// The "GitHub" tab's box for a branch without a pull request: whether the branch is pushed (and whether the worktree has
// commits it has not pushed), how far it is ahead of the base, and a form for the pull request (title, body from the
// repository's template, base, draft). gh needs the branch on GitHub, so the form opens only once it is pushed.
import { GitPullRequest, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { cn, useRequest, type WorktreeInfo } from "@gasho/plugin-sdk";
import type { NewPull } from "../../types.ts";
import { readOp, useWriteOp } from "../daemon.ts";
import { Alert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { INPUT } from "../ui/input.ts";
import { Skeleton } from "../ui/skeleton.tsx";
import { useToast } from "../ui/toast.tsx";

interface Form {
  title: string;
  body: string;
  template?: string;
  draft: boolean;
}

export function NewPullBox({ machine, worktree, branch, repo, title, onCreated }: { machine: string; worktree: WorktreeInfo; branch: string; repo: string; title?: string; onCreated: () => void }) {
  const [base, setBase] = useState<string>();
  // A press of "読み直す" asks GitHub again (after a push); gasho-daemon would answer from what it kept otherwise.
  const [asked, setAsked] = useState(0);
  // A session in the worktree lets the daemon part run git there (ctx.session), for the commits not pushed yet.
  const session = worktree.sessions[0]?.sessionId;
  const r = useRequest<NewPull>({ ...readOp(machine, "new-pull", { repo, branch, ...(base ? { base } : {}), ...(asked ? { fresh: true, asked } : {}) }), ...(session ? { sessionId: session } : {}) }, { staleSeconds: 30 });
  const write = useWriteOp();
  const toast = useToast();
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // What was read before stays while another base is read, so that the form does not go away meanwhile.
  const last = useRef<NewPull>(undefined);
  if (r.data) last.current = r.data;
  const data = r.data ?? last.current;
  if (data?.defaultBranch === branch) return null;
  const chosen = base ?? data?.defaultBranch;
  const compare = data?.compare?.base === chosen ? data?.compare : undefined;
  const nothing = compare?.ahead === 0;
  const reload = () => setAsked((n) => n + 1);

  const start = () => {
    if (!data) return;
    const template = data.templates[0];
    // GitHub's own choice for one commit is its first line; the issue the branch is named after is the next best.
    const one = compare?.commits.length === 1 ? compare.commits[0] : undefined;
    setForm({ title: title ?? one ?? branch, body: template?.body ?? "", ...(template ? { template: template.filename } : {}), draft: true });
    setError(undefined);
  };

  const create = async () => {
    if (!form || !chosen) return;
    setBusy(true);
    setError(undefined);
    const res = await write(machine, "create-pull", { repo, branch, base: chosen, title: form.title, body: form.body, draft: form.draft }, `${repo} に ${branch} から ${chosen} への Pull request を作る`);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const n = (res.data as { number?: number } | undefined)?.number;
    toast({ title: n ? `Pull request #${n} を作りました` : "Pull request を作りました", description: form.title });
    setForm(undefined);
    onCreated();
  };

  return (
    <section aria-label="Pull request を作る" className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-mono break-all">{branch}</span> の Pull request はまだありません
        </p>
        <Button variant="ghost" size="icon" onClick={reload} disabled={r.loading} aria-label="ブランチを読み直す" title="ブランチを読み直す">
          <RefreshCw className={cn(r.loading && "animate-spin")} />
        </Button>
        {!form && (
          <Button variant="primary" onClick={start} disabled={!data?.headOid || !chosen}>
            Pull request を作る
          </Button>
        )}
      </div>

      {!data && r.loading && <Skeleton className="h-4 w-2/3" />}
      {r.error && <Alert tone="danger">{r.error}</Alert>}
      {data && !data.headOid && (
        <Alert
          tone="warning"
          action={
            <Button size="xs" onClick={reload} isLoading={r.loading}>
              読み直す
            </Button>
          }
        >
          ブランチ <span className="font-mono">{branch}</span> を GitHub に push していません。push すると、ここから Pull request を作れます。
        </Alert>
      )}
      {data?.local?.ahead !== undefined && data.local.ahead > 0 && (
        <Alert tone="warning">手元に、GitHub に push していない commit が {data.local.ahead} 件あります。Pull request には、push した分だけが入ります。</Alert>
      )}
      {data?.local?.behind && <Alert>GitHub のブランチに、この worktree に無い commit があります。</Alert>}
      {compare && (
        <p className="text-xs text-muted-foreground">
          {nothing ? (
            <>
              <span className="font-mono">{compare.base}</span> と同じ内容で、Pull request にする commit がありません。
            </>
          ) : (
            <>
              <span className="font-mono">{compare.base}</span> より {compare.ahead} commit 進んでいます
              {compare.behind > 0 && `（${compare.behind} commit 遅れています）`}
            </>
          )}
        </p>
      )}

      {form && data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-2"
        >
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Pull request の題" placeholder="題" maxLength={256} className={INPUT} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">base</span>
              <select value={chosen} onChange={(e) => setBase(e.target.value)} className="max-w-64 rounded-md border border-border bg-transparent px-2 py-1 font-mono text-xs">
                {data.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            {data.templates.length > 1 && (
              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">テンプレート</span>
                <select
                  value={form.template}
                  onChange={(e) => setForm({ ...form, template: e.target.value, body: data.templates.find((t) => t.filename === e.target.value)?.body ?? form.body })}
                  className="max-w-64 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
                >
                  {data.templates.map((t) => (
                    <option key={t.filename} value={t.filename}>
                      {t.filename}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.draft} onChange={(e) => setForm({ ...form, draft: e.target.checked })} />
              Draft にする
            </label>
          </div>
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && form.title.trim() && !busy && !nothing) {
                e.preventDefault();
                void create();
              }
            }}
            aria-label="Pull request の本文"
            placeholder={data.templates.length ? "本文（Markdown）" : "本文（Markdown。この repo に Pull request のテンプレートはありません）"}
            rows={10}
            className={INPUT}
          />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setForm(undefined)} disabled={busy}>
              やめる
            </Button>
            <Button type="submit" variant="primary" disabled={!form.title.trim() || nothing || !data.headOid} isLoading={busy} loadingText="作っています…">
              {form.draft ? "Draft の Pull request を作る" : "Pull request を作る"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
