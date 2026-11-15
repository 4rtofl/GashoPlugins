// The repositories an issue of `repo` can be moved to: { repo } → string[] (owner/name, by name). GitHub moves issues
// only between repositories of the same owner that have issues and that the login can write to, and never from a
// repository that is not public into a public one. gh reads at most 200 of the owner's repositories.
import { gh, KEEP_MAX_SECONDS } from "../core.ts";
import { repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

export const reposArgs = (owner: string): string[] => ["repo", "list", owner, "--limit", "200", "--json", "nameWithOwner,hasIssuesEnabled,isArchived,viewerPermission,visibility"];

const CAN_WRITE = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

export function transferTargets(json: string, repo: string): string[] {
  const repos = (JSON.parse(json) as unknown[]).map((r) => (r ?? {}) as Record<string, unknown>);
  const self = repos.find((r) => str(r.nameWithOwner)?.toLowerCase() === repo.toLowerCase());
  const fromPublic = str(self?.visibility)?.toUpperCase() === "PUBLIC";
  return repos
    .filter(
      (r) =>
        r !== self &&
        r.hasIssuesEnabled === true &&
        r.isArchived !== true &&
        CAN_WRITE.has(str(r.viewerPermission)?.toUpperCase() ?? "") &&
        // Unknown when the repository itself is not among those read: GitHub refuses the ones it does not allow.
        (!self || fromPublic || str(r.visibility)?.toUpperCase() !== "PUBLIC"),
    )
    .flatMap((r) => str(r.nameWithOwner) ?? [])
    .sort((a, b) => a.localeCompare(b));
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const owner = repo.split("/")[0] as string;
    return gh(`list the repositories of ${owner}`, async () => transferTargets((await ctx.github.read(reposArgs(owner), { maxAgeSeconds: KEEP_MAX_SECONDS })).stdout, repo), ctx);
  },
} satisfies Op;
