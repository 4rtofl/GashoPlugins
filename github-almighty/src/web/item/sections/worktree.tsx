// Work on the item in a worktree of its own: for an issue, a new branch named after it (feat/<number>-…) from the default
// branch; for a pull request, its head branch. The worktree goes beside the repository's folder, and a Gasho session
// starts there with a first instruction about the item, as "新しいセッション" would start it, so that taking up an issue
// needs no terminal. A worktree that has the branch already is opened rather than made again: its Gasho session used
// last, or a new one there.
import { FolderGit2, FolderOpen, Play } from "lucide-react";
import { useState } from "react";
import { useLaunchSession, useMachines, useNavigation, useRequest, useSendInput, type SessionInfo } from "@gasho/plugin-sdk";
import type { MadeWorktree } from "../../../daemon/ops/worktree.ts";
import type { Worktrees } from "../../../daemon/ops/worktrees.ts";
import { readOp, useWriteOp } from "../../daemon.ts";
import { Alert } from "../../ui/alert.tsx";
import { Button } from "../../ui/button.tsx";
import { INPUT } from "../../ui/input.ts";
import { issueBranch, branchNumber, worktreePath } from "../../worktree-names.ts";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

const lastUsed = (s: SessionInfo): number => s.lastActivityAt ?? s.startedAt ?? 0;

interface Trust {
  path: string;
  warnings: string[];
  text: string;
}

function WorktreeSection() {
  const { machine, worktree, item, where } = useItem();
  const info = useMachines().find((m) => m.id === machine);
  const repoFolder = worktree.repo;
  const r = useRequest<Worktrees>(repoFolder ? readOp(machine, "worktrees", { repoFolder }) : undefined);
  const write = useWriteOp();
  const launch = useLaunchSession();
  const send = useSendInput();
  const nav = useNavigation();
  const [form, setForm] = useState<{ branch: string; path: string; pathEdited: boolean; text: string }>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [trust, setTrust] = useState<Trust>();

  const isIssue = item.kind === "issues";
  const branch = isIssue ? undefined : item.head;
  if (!repoFolder || !info?.canLaunch || (!isIssue && !branch)) return null;

  const mine = (r.data?.worktrees ?? []).filter((w) => w.path !== worktree.path && (isIssue ? branchNumber(w.branch) === item.number : w.branch === branch));
  const here = isIssue ? branchNumber(worktree.branch) === item.number : worktree.branch === branch;
  const firstText = isIssue
    ? `Issue #${item.number}「${item.title}」に取りかかってください。まず gh issue view ${item.number} で内容を読んでください。`
    : `Pull request #${item.number}「${item.title}」の作業をします。まず gh pr view ${item.number} --comments で内容とレビューを読んでください。`;

  /** Starts a session in `path` (asking about trust first when Claude Code does), sends `text`, and opens it. */
  const start = async (path: string, text: string, trusted = false) => {
    setBusy("start");
    setError(undefined);
    const res = await launch({ machine, cwd: path, ...(trusted && { trust: true }) });
    if (!res.ok) {
      setBusy(undefined);
      if (res.needsTrust) setTrust({ path, warnings: res.trustWarnings ?? [], text });
      else setError(res.error);
      return;
    }
    if (text.trim()) {
      const sent = await send({ machine, sessionId: res.sessionId, text: text.trim() });
      if (!sent.ok) setError(`セッションは起動しましたが、最初の指示を送れませんでした：${sent.error}`);
    }
    setBusy(undefined);
    nav.openSession(machine, res.sessionId);
  };

  /** The worktree's Gasho session used last, or a new one there. */
  const open = async (path: string, text: string) => {
    const session = info.sessions.filter((s) => s.managed && (s.worktree?.path ?? s.cwd) === path).sort((a, b) => lastUsed(b) - lastUsed(a))[0];
    if (session) nav.openSession(machine, session.sessionId);
    else await start(path, text);
  };

  const make = async () => {
    if (!form) return;
    setBusy("make");
    setError(undefined);
    const res = await write(
      machine,
      "worktree",
      { repo: where.repo, kind: item.kind, number: item.number, repoFolder, branch: form.branch.trim(), path: form.path.trim() },
      `#${item.number} の worktree（${form.branch.trim()}）を作る`,
    );
    setBusy(undefined);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const made = res.data as MadeWorktree;
    r.reload();
    setForm(undefined);
    await open(made.path, form.text);
  };

  const openForm = () => {
    const b = branch ?? issueBranch(item.number, item.title);
    setError(undefined);
    setForm({ branch: b, path: worktreePath(repoFolder, b), pathEdited: false, text: firstText });
  };

  return (
    <div className="space-y-2 rounded-xl border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">worktree</span>
        {here && <span className="text-muted-foreground">この worktree で作業しています</span>}
        {mine.map((w) => (
          <Button key={w.path} size="xs" leftIcon={<FolderOpen />} disabled={busy !== undefined} isLoading={busy === "start"} loadingText="起動しています…" onClick={() => void open(w.path, firstText)} title={w.path}>
            {w.branch ?? w.path} を開く
          </Button>
        ))}
        {!here && mine.length === 0 && !form && (
          <Button size="xs" variant="primary" leftIcon={<Play />} disabled={busy !== undefined || !r.data} onClick={openForm}>
            {isIssue ? "worktree を作って始める" : "worktree で開く"}
          </Button>
        )}
        {r.error && <span className="text-muted-foreground" title={r.error}>worktree の一覧を読めませんでした</span>}
      </div>

      {form && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-muted-foreground">ブランチ{isIssue ? "（無ければ、既定のブランチから作る）" : ""}</span>
            <input
              value={form.branch}
              readOnly={!isIssue}
              onChange={(e) => {
                const b = e.target.value;
                setForm({ ...form, branch: b, ...(!form.pathEdited && { path: worktreePath(repoFolder, b.trim()) }) });
              }}
              className={`${INPUT} font-mono`}
              maxLength={250}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">置き場所</span>
            <input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value, pathEdited: true })} className={`${INPUT} font-mono`} maxLength={1000} />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">最初の指示（空なら送らない）</span>
            <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={3} className={INPUT} />
          </label>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="xs"
              leftIcon={<Play />}
              onClick={() => void make()}
              isLoading={busy === "make" || busy === "start"}
              loadingText={busy === "make" ? "worktree を作っています…" : "起動しています…"}
              disabled={busy !== undefined || !form.branch.trim() || !form.path.trim().startsWith("/")}
            >
              作ってセッションを起動する
            </Button>
            <Button size="xs" onClick={() => setForm(undefined)} disabled={busy !== undefined}>
              やめる
            </Button>
          </div>
        </div>
      )}

      {trust && (
        <Alert
          tone="warning"
          action={
            <div className="flex gap-1.5">
              <Button
                size="xs"
                variant="primary"
                onClick={() => {
                  const t = trust;
                  setTrust(undefined);
                  void start(t.path, t.text, true);
                }}
              >
                信頼して起動する
              </Button>
              <Button size="xs" onClick={() => setTrust(undefined)}>
                やめる
              </Button>
            </div>
          }
        >
          <p>Claude Code は、{trust.path} をまだ信頼していません。信頼して起動しますか？</p>
          {trust.warnings.map((w, i) => (
            <p key={i} className="mt-1 text-xs">
              {w}
            </p>
          ))}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

export default { order: 12, kinds: ["issues", "pulls"], View: WorktreeSection } satisfies ItemSection;
