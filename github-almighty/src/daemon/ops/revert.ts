// Opens a pull request that reverts a merged one, as GitHub's "Revert" button does (a new branch with the commit that
// undoes the merge, titled Revert "<title>"): { repo, number, draft? } → { number, url } of the new pull request.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, KEEP_MAX_SECONDS } from "../core.ts";
import { num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

/** The pull request's node ID, which the mutation takes. */
export const pullIdArgs = (repo: string, number: number): string[] => ["pr", "view", String(number), "--repo", repo, "--json", "id"];

export function revertArgs(id: string, draft: boolean): string[] {
  const query = "mutation($id: ID!, $draft: Boolean!) { revertPullRequest(input: {pullRequestId: $id, draft: $draft}) { revertPullRequest { number url } } }";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `id=${id}`, "-F", `draft=${draft}`];
}

/** The new pull request. */
export interface Reverted {
  number: number;
  url: string;
}

export function parseRevert(json: string): Reverted {
  const pr = (JSON.parse(json) as { data?: { revertPullRequest?: { revertPullRequest?: { number?: unknown; url?: unknown } | null } | null } }).data?.revertPullRequest?.revertPullRequest;
  const number = num(pr?.number);
  const url = str(pr?.url);
  if (number === undefined || !url?.startsWith("https://github.com/")) throw new PluginError("Revert する Pull request を作れたか分かりません。GitHub で確かめてください。");
  return { number, url };
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    if (p.draft !== undefined && typeof p.draft !== "boolean") throw new PluginError("Draft にするかの指定が正しくありません。");
    const draft = p.draft === true;
    // A node ID never changes, so the kept answer can be old.
    const id = str((JSON.parse((await gh(`read the ID of #${number}`, () => ctx.github.read(pullIdArgs(repo, number), { maxAgeSeconds: KEEP_MAX_SECONDS }), ctx)).stdout) as { id?: unknown }).id);
    if (!id) throw new PluginError(`${repo} に Pull request #${number} はありません。`);
    const { stdout } = await gh(`revert #${number}`, () => ctx.github.write(revertArgs(id, draft), { repo }), ctx);
    return parseRevert(stdout);
  },
} satisfies Op;
