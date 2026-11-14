// The sample board plugin: puts a card in a column by its pull request, the pull request's CI and conflicts, its Claude
// Code sessions and its deploys, marks the Stacks each worktree deployed to, offers what to ask Claude next on the
// card's menu, and shows above the board the worktree that deployed to each Stack last. The cards do not have the CI,
// the conflicts and the deploys, so `fetch` reads them with gh and ps (stacks.ts).
import type { Fetch, Headings, Placement, State, StateCard } from "../types.ts";
import { deployingTo, readStacks, stackHeadings, stackMarks, type Stacks } from "./stacks.ts";

/** Of my open pull requests (by number), those whose CI runs or failed, or that conflict; and what was seen of each Stack. */
export interface Info {
  prs: Record<number, { ci?: "pending" | "failure"; conflict?: true }>;
  stacks: Stacks;
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** gh's statusCheckRollup: check runs (status, conclusion) and commit statuses (state). */
function ciOf(checks: unknown): "pending" | "failure" | undefined {
  const list = (Array.isArray(checks) ? checks : []) as { __typename?: string; status?: string; conclusion?: string; state?: string }[];
  const status = (c: (typeof list)[number]) => (c.__typename === "StatusContext" ? { done: c.state !== "PENDING" && c.state !== "EXPECTED", result: c.state } : { done: c.status === "COMPLETED", result: c.conclusion });
  if (list.some((c) => FAILED.has(status(c).result ?? ""))) return "failure";
  if (list.some((c) => !status(c).done)) return "pending";
  return undefined;
}

export const fetch: Fetch<Info, Stacks> = async (repo, { github, exec, store }) => {
  const stacks = await readStacks(repo, { exec, store });
  if (repo.prs.length === 0) return { prs: {}, stacks };
  const { stdout } = await github.read(["pr", "list", "--repo", repo.repo, "--author", "@me", "--state", "open", "--limit", "100", "--json", "number,mergeable,statusCheckRollup"]);
  const prs: Info["prs"] = {};
  for (const p of JSON.parse(stdout) as { number: number; mergeable?: string; statusCheckRollup?: unknown }[]) {
    const ci = ciOf(p.statusCheckRollup);
    const conflict = p.mergeable === "CONFLICTING";
    if (ci || conflict) prs[p.number] = { ...(ci ? { ci } : {}), ...(conflict ? { conflict: true as const } : {}) };
  }
  return { prs, stacks };
};

function column(card: StateCard, info: Info | undefined): Placement {
  if (card.pr?.state === "merged") return { column: "done", reason: "マージ済み" };
  if (card.pr?.state === "closed") return { column: "done", reason: "クローズ済み" };
  const deploying = deployingTo(card, info?.stacks);
  if (deploying.length > 0) return { column: "github", reason: `${deploying.join("・")} にデプロイしている` };
  if (card.sessions.some((s) => s.status === "waiting")) return { column: "mine", reason: "Claude が答えを待っている" };
  if (card.sessions.some((s) => s.status === "busy")) return { column: "agent", reason: "Claude が作業している" };
  const open = card.pr?.state === "open" ? info?.prs[card.pr.number] : undefined;
  if (open?.conflict) return { column: "mine", reason: "コンフリクトしている" };
  if (open?.ci === "failure") return { column: "mine", reason: "CI が落ちた" };
  if (open?.ci === "pending") return { column: "github", reason: "CI が動いている" };
  if (card.pr && !card.pr.draft) {
    const text = `PR #${card.pr.number} のレビューのコメントを読んで、直すものを直して`;
    return { column: "review", reason: "PR がレビュー待ち", actions: [{ label: "レビューのコメントに対応する", text }] };
  }
  if (card.pr?.draft) {
    const text = `PR #${card.pr.number} の差分を見直して、Ready for review にしてよいか教えて`;
    return { column: "mine", reason: "PR が Draft", actions: [{ label: "PR を見直す", text }] };
  }
  const actions = card.issue === undefined ? [] : [{ label: "Issue を実装する", text: `Issue #${card.issue} を読んで実装して` }];
  return { column: "mine", reason: "PR がまだない", actions };
}

export const state: State<Info> = (card, info) => ({ ...column(card, info), marks: stackMarks(card, info?.stacks) });

export const headings: Headings<Info> = (_repo, info) => stackHeadings(info?.stacks);
