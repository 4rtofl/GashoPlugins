// The repository's open milestones, the nearest due first and those without a due date last: { repo, fresh? } →
// GitHubMilestone[].
import { gh, maxAge } from "../core.ts";
import { milestoneOf } from "../detail/milestone.ts";
import { repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const milestonesArgs = (repo: string): string[] => ["api", `repos/${repo}/milestones?state=open&sort=due_on&direction=asc&per_page=100`];

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    return gh(
      "read the milestones",
      async () => {
        const { stdout } = await ctx.github.read(milestonesArgs(repo), { repo, maxAgeSeconds: maxAge(p) });
        // GitHub puts the ones without a due date first.
        return (JSON.parse(stdout) as unknown[]).flatMap((m) => milestoneOf(m) ?? []).sort((a, b) => Number(!a.dueOn) - Number(!b.dueOn));
      },
      ctx,
    );
  },
} satisfies Op;
