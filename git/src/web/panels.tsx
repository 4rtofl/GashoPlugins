// The panels of the Git plugin (moved here from Gasho's views/github-list.tsx and github-item.tsx): the open issues
// or pull requests of the session's repository, and one of them read in Gasho, with its conversation (comments and
// reviews) and, for a pull request, its branches, size, checks and changed files. An item opens in place of the list
// and goes back to it. Both ask again whenever they are opened (staleSeconds: 0), answered from what gh said recently;
// the reload button makes gh read GitHub again.
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleSlash,
  CircleX,
  ExternalLink,
  GitPullRequest,
  GitPullRequestDraft,
  RefreshCw,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  cn,
  Markdown,
  Panel,
  PANEL_BUTTON,
  panelRepo,
  RelativeTime,
  RepoTabs,
  relativeTime,
  useCall,
  useNavigation,
  useNow,
  useRequest,
  type PanelProps,
  type RequestTarget,
} from "@gasho/plugin-sdk";
import type { GitHubCheck, GitHubComment, GitHubItem, GitHubItemDetail, GitHubList, GitHubListKind, GitHubReview } from "../types.ts";

const TITLE: Record<GitHubListKind, string> = { issues: "Issues", pulls: "Pull requests" };
const NAME: Record<GitHubListKind, string> = { issues: "Issue", pulls: "Pull request" };
const EMPTY: Record<GitHubListKind, string> = {
  issues: "開いている Issue はありません。",
  pulls: "開いている Pull request はありません。",
};
const REVIEW: Record<NonNullable<GitHubItem["review"]>, { label: string; className: string }> = {
  approved: { label: "承認済み", className: "text-emerald-400" },
  changes_requested: { label: "修正の依頼あり", className: "text-amber-400" },
  review_required: { label: "レビュー待ち", className: "" },
};

const kindOf = (params: Record<string, string>): GitHubListKind => (params.kind === "pulls" ? "pulls" : "issues");

/**
 * A read of the daemon part. `reload` (the reload button) asks with `fresh`, so that gh reads GitHub again rather than
 * gasho-daemon answering from what it kept, then asks again (now answered with that). When GitHub could not be read,
 * what was read stays and `error` says why, until it is read again or the target changes.
 */
function useRead<T>(target: RequestTarget | undefined) {
  const r = useRequest<T>(target, { staleSeconds: 0 });
  const call = useCall();
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState<{ key: string; at?: number; error: string }>();
  const key = JSON.stringify(target ?? null);
  const reload = async () => {
    if (!target) return;
    setRefreshing(true);
    const result = await call<T>({ ...target, params: { ...(target.params as Record<string, unknown>), fresh: true } }).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setRefreshing(false);
    if (result.ok) {
      setFailed(undefined);
      r.reload();
    } else {
      setFailed({ key, at: r.at, error: result.error });
    }
  };
  const error = failed && failed.key === key && failed.at === r.at ? `再読み込みできませんでした：${failed.error}` : r.error;
  return { ...r, error, loading: r.loading || refreshing, reload };
}

export function ListPanel({ machine, session, params }: PanelProps) {
  const kind = kindOf(params);
  const nav = useNavigation();
  const now = useNow(60_000);
  // In a folder that holds repositories, the ones on GitHub are tabs (the first one by default).
  const { repos, selected } = panelRepo(session, params.repo, (r) => Boolean(r.github));
  const noRepo = repos ? repos.length === 0 : !session.github;
  const where: Record<string, string> = selected ? { repo: selected.path } : {};
  const r = useRead<GitHubList>(machine.connected && !noRepo ? { machine: machine.id, sessionId: session.sessionId, method: "list", params: { kind, ...where } } : undefined);
  const list = r.data;
  const github = list?.repo ?? (selected ? selected.github : session.github);
  return (
    <Panel
      title={TITLE[kind]}
      subtitle={github ? `${github.owner}/${github.name}` : session.cwd}
      actions={
        <>
          {github && (
            <a href={`${github.url}/${kind === "issues" ? "issues" : "pulls"}`} target="_blank" rel="noreferrer" className={PANEL_BUTTON}>
              GitHub <ExternalLink className="size-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={() => void r.reload()}
            disabled={r.loading || !machine.connected || noRepo}
            aria-label="再読み込み"
            title="再読み込み"
            className={PANEL_BUTTON}
          >
            <RefreshCw className={cn("size-3.5", r.loading && "animate-spin")} />
          </button>
        </>
      }
    >
      {repos && repos.length >= 2 && selected && <RepoTabs repos={repos} selected={selected.path} onSelect={(path) => nav.replacePanel("list", { kind, repo: path })} />}
      <div className="space-y-3">
        {noRepo && <p className="text-sm text-muted-foreground">このセッションのフォルダーには、GitHub のリポジトリがありません。</p>}
        {!machine.connected && <p className="text-sm text-muted-foreground">{machine.name} はオフラインです。</p>}
        {r.error && <p className="text-sm text-red-400">{r.error}</p>}
        {!list && r.loading && !noRepo && <p className="text-sm text-muted-foreground">読み込み中…</p>}
        {list &&
          (list.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{list.disabled ? "このリポジトリでは Issue が無効になっています。" : EMPTY[kind]}</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {list.items.map((item) => {
                const target = { kind, number: String(item.number), ...where };
                return (
                  <ItemRow
                    key={item.number}
                    item={item}
                    kind={kind}
                    now={now}
                    href={nav.panelHref("item", target)}
                    onOpen={(e) => {
                      // Opened in Gasho, in place of the list (the panel's GitHub button still leads to GitHub).
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      nav.openPanel("item", target);
                    }}
                  />
                );
              })}
            </ul>
          ))}
        {list?.truncated && <p className="text-xs text-muted-foreground">新しいものから {list.items.length} 件を表示しています。すべては GitHub で見られます。</p>}
        {r.at && <p className="text-xs text-muted-foreground">{new Date(r.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} に読み込み</p>}
      </div>
    </Panel>
  );
}

function ItemRow({ item, kind, now, href, onOpen }: { item: GitHubItem; kind: GitHubListKind; now: number; href: string; onOpen: (e: React.MouseEvent) => void }) {
  const Icon = kind === "issues" ? CircleDot : item.draft ? GitPullRequestDraft : GitPullRequest;
  const review = item.review ? REVIEW[item.review] : undefined;
  const updated = Date.parse(item.updatedAt);
  return (
    <li>
      <a href={href} onClick={onOpen} className="flex gap-2.5 px-3 py-2.5 hover:bg-surface-raised">
        <Icon
          aria-label={kind === "issues" ? "Issue" : item.draft ? "下書きの Pull request" : "Pull request"}
          className={cn("mt-0.5 size-4 shrink-0", item.draft ? "text-muted-foreground" : "text-emerald-400")}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug break-words">{item.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">#{item.number}</span>
            {item.author && <span>{item.author}</span>}
            {Number.isFinite(updated) && <span title={new Date(updated).toLocaleString("ja-JP")}>更新 {relativeTime(updated, now)}</span>}
            {item.draft && <span>下書き</span>}
            {review && <span className={review.className}>{review.label}</span>}
            {item.head && item.base && (
              <span className="min-w-0 truncate font-mono" title={`${item.head} → ${item.base}`}>
                {item.head} → {item.base}
              </span>
            )}
            {item.labels.map((l) => (
              <span key={l.name} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px">
                {l.color && <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: `#${l.color}` }} />}
                {l.name}
              </span>
            ))}
          </div>
        </div>
      </a>
    </li>
  );
}

export function ItemPanel({ machine, session, params }: PanelProps) {
  const kind = kindOf(params);
  const number = Number(params.number);
  const valid = Number.isInteger(number) && number >= 1 && number <= 1e9;
  const nav = useNavigation();
  const now = useNow(60_000);
  const { selected } = panelRepo(session, params.repo, (r) => Boolean(r.github));
  const where: Record<string, string> = selected ? { repo: selected.path } : {};
  const r = useRead<GitHubItemDetail>(machine.connected && valid ? { machine: machine.id, sessionId: session.sessionId, method: "item", params: { kind, number, ...where } } : undefined);
  const item = r.data;
  const github = selected ? selected.github : session.github;
  const url = item?.url ?? (github && valid ? `${github.url}/${kind === "issues" ? "issues" : "pull"}/${number}` : undefined);
  return (
    <Panel
      title={valid ? `${NAME[kind]} #${number}` : NAME[kind]}
      subtitle={github ? `${github.owner}/${github.name}` : undefined}
      actions={
        <>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className={PANEL_BUTTON}>
              GitHub <ExternalLink className="size-3.5" />
            </a>
          )}
          <button type="button" onClick={() => void r.reload()} disabled={r.loading || !machine.connected || !valid} aria-label="再読み込み" title="再読み込み" className={PANEL_BUTTON}>
            <RefreshCw className={cn("size-3.5", r.loading && "animate-spin")} />
          </button>
        </>
      }
    >
      <button
        type="button"
        onClick={() => nav.back({ id: "list", params: { kind, ...where } })}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {TITLE[kind]} の一覧
      </button>
      <div className="space-y-4">
        {!valid && <p className="text-sm text-red-400">番号が正しくありません。</p>}
        {!machine.connected && <p className="text-sm text-muted-foreground">{machine.name} はオフラインです。</p>}
        {r.error && <p className="text-sm text-red-400">{r.error}</p>}
        {!item && r.loading && valid && <p className="text-sm text-muted-foreground">読み込み中…</p>}
        {item && <ItemView item={item} now={now} />}
      </div>
    </Panel>
  );
}

function ItemView({ item, now }: { item: GitHubItemDetail; now: number }) {
  // Comments and reviews, oldest first, as GitHub shows them.
  const timeline = [
    ...item.comments.map((c) => ({ at: c.createdAt, comment: c })),
    ...(item.reviews ?? []).map((r) => ({ at: r.submittedAt, review: r })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <header className="space-y-2">
        <h3 className="text-lg leading-snug font-semibold break-words">{item.title}</h3>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <StateBadge item={item} />
          <span>
            {item.author ?? "不明"} が<RelativeTime at={item.createdAt} now={now} />
            に作成
          </span>
          <span>
            更新 <RelativeTime at={item.updatedAt} now={now} />
          </span>
          {item.assignees.length > 0 && <span>担当：{item.assignees.join("、")}</span>}
        </div>
        {item.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {item.labels.map((l) => (
              <span key={l.name} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px">
                {l.color && <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: `#${l.color}` }} />}
                {l.name}
              </span>
            ))}
          </div>
        )}
      </header>

      {item.kind === "pulls" && <PullSummary item={item} />}

      <Card author={item.author} at={item.createdAt} now={now}>
        {item.body.trim() ? <Markdown text={item.body} /> : <p className="text-sm text-muted-foreground">説明はありません。</p>}
      </Card>

      {item.commentsLeftOut ? <p className="text-xs text-muted-foreground">古いコメント {item.commentsLeftOut} 件は省いています。GitHub で読めます。</p> : null}
      {timeline.map((t, i) =>
        "comment" in t && t.comment ? (
          <CommentCard key={`c${i}`} comment={t.comment} now={now} />
        ) : "review" in t && t.review ? (
          <ReviewCard key={`r${i}`} review={t.review} now={now} />
        ) : null,
      )}
      {timeline.length === 0 && <p className="text-xs text-muted-foreground">コメントはまだありません。</p>}

      {item.kind === "pulls" && item.files && item.files.length > 0 && <Files item={item} />}
    </>
  );
}

function StateBadge({ item }: { item: GitHubItemDetail }) {
  const [label, tone, Icon] =
    item.state === "merged"
      ? (["Merged", "bg-violet-500/15 text-violet-300", GitPullRequest] as const)
      : item.state === "closed"
        ? item.kind === "pulls"
          ? (["Closed", "bg-red-500/15 text-red-300", GitPullRequest] as const)
          : item.stateReason === "not_planned"
            ? (["Closed（対応しない）", "bg-white/[0.08] text-neutral-300", CircleSlash] as const)
            : (["Closed", "bg-violet-500/15 text-violet-300", CircleCheck] as const)
        : item.draft
          ? (["Draft", "bg-white/[0.08] text-neutral-300", GitPullRequest] as const)
          : (["Open", "bg-emerald-500/15 text-emerald-300", item.kind === "pulls" ? GitPullRequest : CircleDot] as const);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", tone)}>
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

/** A pull request's branches, size, review state and checks. */
function PullSummary({ item }: { item: GitHubItemDetail }) {
  const decision = item.review ? REVIEW[item.review] : undefined;
  const checks = item.checks ?? [];
  const failing = checks.filter((c) => c.state === "failure").length;
  const pending = checks.filter((c) => c.state === "pending").length;
  const passed = checks.filter((c) => c.state === "success").length;
  return (
    <section className="space-y-2 rounded-xl border border-border px-3 py-2.5 text-xs text-muted-foreground">
      {item.head && item.base && (
        <p className="font-mono break-all">
          {item.head} → {item.base}
        </p>
      )}
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        {item.additions !== undefined && item.deletions !== undefined && (
          <span className="tabular-nums">
            <span className="text-emerald-400">+{item.additions.toLocaleString()}</span> <span className="text-red-400">−{item.deletions.toLocaleString()}</span>
          </span>
        )}
        {item.changedFiles !== undefined && <span>{item.changedFiles} ファイル</span>}
        {item.commits !== undefined && <span>{item.commits} コミット</span>}
        {decision && <span className={decision.className}>{decision.label}</span>}
      </p>
      {checks.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
            チェック：
            {failing > 0 && <span className="text-red-400">失敗 {failing}</span>}
            {pending > 0 && <span className="text-amber-400">実行中 {pending}</span>}
            {passed > 0 && <span className="text-emerald-400">成功 {passed}</span>}
            {checks.length - failing - pending - passed > 0 && <span>その他 {checks.length - failing - pending - passed}</span>}
          </summary>
          <ul className="mt-1.5 space-y-1 pl-5">
            {checks.map((c, i) => (
              <li key={`${c.name}${i}`} className="flex min-w-0 items-center gap-1.5">
                <CheckIcon state={c.state} />
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-foreground hover:underline" title={c.name}>
                    {c.name}
                  </a>
                ) : (
                  <span className="min-w-0 truncate" title={c.name}>
                    {c.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CheckIcon({ state }: { state: GitHubCheck["state"] }) {
  if (state === "success") return <CircleCheck aria-label="成功" className="size-3.5 shrink-0 text-emerald-400" />;
  if (state === "failure") return <CircleX aria-label="失敗" className="size-3.5 shrink-0 text-red-400" />;
  if (state === "pending") return <CircleDashed aria-label="実行中" className="size-3.5 shrink-0 text-amber-400" />;
  return <CircleMinus aria-label="スキップ" className="size-3.5 shrink-0" />;
}

/** A bordered block of the conversation: who wrote it and when, then the text. */
function Card({ author, at, now, badge, children }: { author?: string; at: string; now: number; badge?: ReactNode; children: ReactNode }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface/60 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/90">{author ?? "不明"}</span>
        <RelativeTime at={at} now={now} />
        {badge}
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </article>
  );
}

function CommentCard({ comment: c, now }: { comment: GitHubComment; now: number }) {
  return (
    <Card author={c.author} at={c.createdAt} now={now}>
      {c.minimized ? (
        <p className="text-sm text-muted-foreground">GitHub で非表示にされたコメントです。</p>
      ) : c.body.trim() ? (
        <Markdown text={c.body} />
      ) : (
        <p className="text-sm text-muted-foreground">（本文なし）</p>
      )}
    </Card>
  );
}

const REVIEW_STATE: Record<GitHubReview["state"], { label: string; className: string }> = {
  approved: { label: "承認", className: "bg-emerald-500/15 text-emerald-300" },
  changes_requested: { label: "修正を依頼", className: "bg-amber-500/15 text-amber-300" },
  commented: { label: "レビューのコメント", className: "bg-white/[0.08] text-neutral-300" },
  dismissed: { label: "取り消されたレビュー", className: "bg-white/[0.08] text-neutral-400" },
  pending: { label: "未送信のレビュー", className: "bg-white/[0.08] text-neutral-400" },
};

function ReviewCard({ review: r, now }: { review: GitHubReview; now: number }) {
  const state = REVIEW_STATE[r.state];
  return (
    <Card author={r.author} at={r.submittedAt} now={now} badge={<span className={cn("rounded-full px-1.5 py-px", state.className)}>{state.label}</span>}>
      {r.body.trim() ? <Markdown text={r.body} /> : <p className="text-sm text-muted-foreground">（本文なし）</p>}
    </Card>
  );
}

/** The files a pull request changes, folded. */
function Files({ item }: { item: GitHubItemDetail }) {
  const files = item.files ?? [];
  return (
    <details className="group rounded-xl border border-border text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        変更したファイル（{item.changedFiles ?? files.length}）
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {files.map((f) => (
          <li key={f.path} className="flex items-center gap-3 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>
              {f.path}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="text-emerald-400">+{f.additions}</span> <span className="text-red-400">−{f.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
      {item.changedFiles !== undefined && item.changedFiles > files.length && (
        <p className="border-t border-border px-3 py-1.5 text-muted-foreground">ほかに {item.changedFiles - files.length} ファイルあります。GitHub で見られます。</p>
      )}
    </details>
  );
}
