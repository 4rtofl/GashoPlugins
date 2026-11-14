// Whether a pull request can be merged now, how, and what keeps it from it: { repo, number, fresh? } → PullMerge.
// One GraphQL query (1 point) reads the repository's merge settings with the pull request, as `gh pr view --json` has
// neither those nor which checks the base branch requires.
import { PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import { gh, maxAge } from "../core.ts";
import { login, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

export type MergeMethod = "merge" | "squash" | "rebase";

/** What keeps a pull request from being merged now. */
export type MergeBlocker =
  | { kind: "draft" }
  | { kind: "conflict" }
  /** Required checks that failed, and those that have not finished. */
  | { kind: "checks"; failing: string[]; pending: string[] }
  | { kind: "review"; decision: "changes_requested" | "review_required" }
  /** The base branch requires the head to be up to date with it. */
  | { kind: "behind" }
  /** GitHub has not worked out yet whether it merges cleanly. */
  | { kind: "unknown" }
  /** A rule of the base branch that is none of the above (signed commits, resolved conversations, …). */
  | { kind: "rule" };

export interface PullMerge {
  /** The methods the repository allows, in GitHub's order. */
  methods: MergeMethod[];
  /** The one GitHub offers this login first (the last one it used). */
  preferred?: MergeMethod;
  /** False when the commits cannot be rebased onto the base (rebase is then not offered). */
  rebaseable: boolean;
  /** The repository deletes the head branch once a pull request is merged. */
  deletesBranch: boolean;
  /** The head branch, when it is in this repository and still there: what a merge can delete. */
  head?: string;
  /** The head commit as read: a merge only happens if the head is still this one. */
  headOid?: string;
  base?: string;
  /** The base branch merges through a merge queue: a merge puts the pull request in it, and deletes no branch. */
  queue: boolean;
  /** It is in the merge queue now. */
  queued: boolean;
  blockers: MergeBlocker[];
  /** Checks that did not pass but are not required: a merge is still allowed. */
  unstable: string[];
  auto: {
    /** The repository allows auto-merge. */
    allowed: boolean;
    canEnable: boolean;
    canDisable: boolean;
    on?: { method: MergeMethod; by?: string; at?: string };
  };
}

const QUERY = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
  mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed deleteBranchOnMerge viewerDefaultMergeMethod
  pullRequest(number: $number) {
    isDraft mergeable mergeStateStatus reviewDecision canBeRebased isCrossRepository headRefOid baseRefName headRef { name } isMergeQueueEnabled isInMergeQueue
    viewerCanEnableAutoMerge viewerCanDisableAutoMerge autoMergeRequest { mergeMethod enabledAt enabledBy { login } }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
      __typename ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
      ... on StatusContext { context state isRequired(pullRequestNumber: $number) }
    } } } } } }
  }
} }`.replace(/\s+/g, " ");

export const mergeableArgs = (repo: string, number: number): string[] => {
  const [owner, name] = repo.split("/") as [string, string];
  return ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
};

const METHOD: Record<string, MergeMethod> = { MERGE: "merge", SQUASH: "squash", REBASE: "rebase" };
const ALLOWED: [MergeMethod, string][] = [
  ["merge", "mergeCommitAllowed"],
  ["squash", "squashMergeAllowed"],
  ["rebase", "rebaseMergeAllowed"],
];

/** A required check run passes when it succeeded or was skipped or neutral, as GitHub counts it. */
function checkResult(c: Record<string, unknown>): "pass" | "fail" | "pending" {
  if (c.__typename === "StatusContext") {
    const state = str(c.state)?.toUpperCase();
    return state === "SUCCESS" ? "pass" : state === "FAILURE" || state === "ERROR" ? "fail" : "pending";
  }
  if (str(c.status)?.toUpperCase() !== "COMPLETED") return "pending";
  const conclusion = str(c.conclusion)?.toUpperCase();
  return conclusion === "SUCCESS" || conclusion === "SKIPPED" || conclusion === "NEUTRAL" ? "pass" : "fail";
}

/** The output of mergeableArgs; undefined when the pull request is not there. */
export function parseMergeable(json: string): PullMerge | undefined {
  const repo = ((JSON.parse(json) as { data?: { repository?: Record<string, unknown> | null } }).data?.repository ?? undefined) as Record<string, unknown> | undefined;
  const pr = repo?.pullRequest as Record<string, unknown> | null | undefined;
  if (!repo || !pr) return undefined;

  const methods = ALLOWED.filter(([, key]) => repo[key] === true).map(([m]) => m);
  const preferred = METHOD[str(repo.viewerDefaultMergeMethod) ?? ""];

  const contexts = ((pr.commits as { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: unknown[] } } | null } }[] } | undefined)?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []) as Record<string, unknown>[];
  const failing: string[] = [];
  const pending: string[] = [];
  const unstable: string[] = [];
  for (const c of contexts) {
    const name = str(c?.name) ?? str(c?.context);
    if (!name) continue;
    const result = checkResult(c);
    if (c.isRequired === true) {
      if (result === "fail") failing.push(name);
      if (result === "pending") pending.push(name);
    } else if (result === "fail") unstable.push(name);
  }

  const mergeable = str(pr.mergeable)?.toUpperCase();
  const status = str(pr.mergeStateStatus)?.toUpperCase();
  const decision = str(pr.reviewDecision)?.toUpperCase();
  const blockers: MergeBlocker[] = [];
  if (pr.isDraft === true) blockers.push({ kind: "draft" });
  if (mergeable === "CONFLICTING" || status === "DIRTY") blockers.push({ kind: "conflict" });
  if (failing.length > 0 || pending.length > 0) blockers.push({ kind: "checks", failing, pending });
  // Without a rule that requires reviews, a request for changes does not keep GitHub from merging.
  if (status === "BLOCKED" && (decision === "CHANGES_REQUESTED" || decision === "REVIEW_REQUIRED")) {
    blockers.push({ kind: "review", decision: decision === "CHANGES_REQUESTED" ? "changes_requested" : "review_required" });
  }
  if (status === "BEHIND") blockers.push({ kind: "behind" });
  if (blockers.length === 0 && (mergeable === "UNKNOWN" || status === "UNKNOWN")) blockers.push({ kind: "unknown" });
  if (blockers.length === 0 && status === "BLOCKED") blockers.push({ kind: "rule" });

  const auto = pr.autoMergeRequest as Record<string, unknown> | null | undefined;
  const autoMethod = METHOD[str(auto?.mergeMethod) ?? ""];
  const head = pr.isCrossRepository === true ? undefined : str((pr.headRef as { name?: unknown } | null | undefined)?.name);
  const headOid = str(pr.headRefOid);
  const base = str(pr.baseRefName);
  const by = login(auto?.enabledBy);
  const at = str(auto?.enabledAt);
  return {
    methods,
    ...(preferred && methods.includes(preferred) ? { preferred } : {}),
    rebaseable: pr.canBeRebased !== false,
    deletesBranch: repo.deleteBranchOnMerge === true,
    ...(head ? { head } : {}),
    ...(headOid && /^[0-9a-f]{40}$/.test(headOid) ? { headOid } : {}),
    ...(base ? { base } : {}),
    queue: pr.isMergeQueueEnabled === true,
    queued: pr.isInMergeQueue === true,
    blockers,
    unstable,
    auto: {
      allowed: repo.autoMergeAllowed === true,
      canEnable: pr.viewerCanEnableAutoMerge === true,
      canDisable: pr.viewerCanDisableAutoMerge === true,
      ...(auto && autoMethod ? { on: { method: autoMethod, ...(by ? { by } : {}), ...(at ? { at } : {}) } } : {}),
    },
  };
}

/** GitHub works out whether a pull request merges cleanly after it is first asked: one more read, a moment later. */
const UNKNOWN_RETRY_MS = 2500;

async function read(ctx: Pick<DaemonContext, "github">, repo: string, number: number, maxAgeSeconds: number): Promise<PullMerge | undefined> {
  const { stdout } = await ctx.github.read(mergeableArgs(repo, number), { repo, maxAgeSeconds });
  return parseMergeable(stdout);
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(
      `read whether #${number} can be merged`,
      async () => {
        let merge = await read(ctx, repo, number, maxAge(p));
        if (merge?.blockers.some((b) => b.kind === "unknown")) {
          await new Promise((resolve) => setTimeout(resolve, UNKNOWN_RETRY_MS));
          merge = await read(ctx, repo, number, 0);
        }
        if (!merge) throw new PluginError("この番号の Pull request は見つかりません。");
        return merge;
      },
      ctx,
    );
  },
} satisfies Op;
