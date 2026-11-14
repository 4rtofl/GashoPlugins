// The sample board plugin: puts a card in a column by its pull request, the pull request's CI and conflicts, and its
// Claude Code sessions. The cards do not have the CI and the conflicts, so `fetch` reads them with gh.
import type { Fetch, State } from "../types.ts";

/** Of my open pull requests (by number), those whose CI runs or failed, or that conflict. */
export interface Info {
  prs: Record<number, { ci?: "pending" | "failure"; conflict?: true }>;
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

export const fetch: Fetch<Info> = async (repo, { github }) => {
  if (repo.prs.length === 0) return { prs: {} };
  const { stdout } = await github.read(["pr", "list", "--repo", repo.repo, "--author", "@me", "--state", "open", "--limit", "100", "--json", "number,mergeable,statusCheckRollup"]);
  const prs: Info["prs"] = {};
  for (const p of JSON.parse(stdout) as { number: number; mergeable?: string; statusCheckRollup?: unknown }[]) {
    const ci = ciOf(p.statusCheckRollup);
    const conflict = p.mergeable === "CONFLICTING";
    if (ci || conflict) prs[p.number] = { ...(ci ? { ci } : {}), ...(conflict ? { conflict: true as const } : {}) };
  }
  return { prs };
};

export const state: State<Info> = (card, info) => {
  if (card.pr?.state === "merged") return { column: "done", reason: "マージ済み" };
  if (card.pr?.state === "closed") return { column: "done", reason: "クローズ済み" };
  if (card.sessions.some((s) => s.status === "waiting")) return { column: "mine", reason: "Claude が答えを待っている" };
  if (card.sessions.some((s) => s.status === "busy")) return { column: "agent", reason: "Claude が作業している" };
  const open = card.pr?.state === "open" ? info?.prs[card.pr.number] : undefined;
  if (open?.conflict) return { column: "mine", reason: "コンフリクトしている" };
  if (open?.ci === "failure") return { column: "mine", reason: "CI が落ちた" };
  if (open?.ci === "pending") return { column: "github", reason: "CI が動いている" };
  if (card.pr && !card.pr.draft) return { column: "review", reason: "PR がレビュー待ち" };
  if (card.pr?.draft) return { column: "mine", reason: "PR が Draft" };
  return { column: "mine", reason: "PR がまだない" };
};
