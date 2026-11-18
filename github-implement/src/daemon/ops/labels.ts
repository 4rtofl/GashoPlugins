// The repository's labels found by `query`, for the pickers when the repository has more labels than "meta" reads
// (RepoMeta.labelsMore): { repo, query } → FoundLabels. GitHub finds those with a word that starts with it ("en" finds
// "enhancement", "e" and "ment" nothing), so the pickers also narrow what "meta" read. One GraphQL query (1 point).
import { gh, keepSeconds } from "../core.ts";
import { labelColor, num, repoArg, str, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

export interface FoundLabels {
  /** By name. */
  labels: { name: string; color?: string }[];
  /** GitHub found more than these. */
  more: boolean;
}

const FIRST = 50;

export function labelsQueryArgs(repo: string, query: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const q =
    "query($owner: String!, $name: String!, $filter: String!) { repository(owner: $owner, name: $name) { " +
    `labels(query: $filter, first: ${FIRST}, orderBy: {field: NAME, direction: ASC}) { totalCount nodes { name color } } } }`;
  return ["api", "graphql", "-f", `query=${q}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `filter=${query}`];
}

export function parseLabels(json: string): FoundLabels {
  const found = (JSON.parse(json) as { data?: { repository?: { labels?: { totalCount?: unknown; nodes?: unknown[] } | null } | null } }).data?.repository?.labels;
  const labels = (found?.nodes ?? []).flatMap((l) => {
    const r = (l ?? {}) as Record<string, unknown>;
    const name = str(r.name);
    const color = labelColor(r.color);
    return name ? [{ name, ...(color ? { color } : {}) }] : [];
  });
  return { labels, more: (num(found?.totalCount) ?? 0) > labels.length };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const query = textArg(p.query, "ラベルの名前", 100).trim();
    return gh("search the labels", async () => parseLabels((await ctx.github.read(labelsQueryArgs(repo, query), { repo, maxAgeSeconds: keepSeconds() })).stdout), ctx);
  },
} satisfies Op;
