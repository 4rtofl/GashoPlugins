// The repository's branches whose names have `query` in them, by name, for picking a pull request's base:
// { repo, query? } → { names: string[], more: boolean }. GitHub narrows them (refs' query), so a repository with many
// branches finds any of them.
import { gh, keepSeconds } from "../core.ts";
import { repoArg, str, textArg } from "../gh.ts";
import type { Op } from "../op.ts";

const FIRST = 30;

export function branchesQueryArgs(repo: string, query: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const q =
    "query($owner: String!, $name: String!, $filter: String!) { repository(owner: $owner, name: $name) { " +
    `refs(refPrefix: "refs/heads/", query: $filter, first: ${FIRST}, orderBy: {field: ALPHABETICAL, direction: ASC}) { nodes { name } pageInfo { hasNextPage } } } }`;
  return ["api", "graphql", "-f", `query=${q}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `filter=${query}`];
}

export function parseBranches(json: string): { names: string[]; more: boolean } {
  const refs = (JSON.parse(json) as { data?: { repository?: { refs?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: unknown } } } | null } }).data?.repository?.refs;
  return {
    names: (refs?.nodes ?? []).flatMap((n) => str((n as { name?: unknown } | null)?.name) ?? []),
    more: refs?.pageInfo?.hasNextPage === true,
  };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const query = p.query === undefined ? "" : textArg(p.query, "ブランチの名前", 250).trim();
    return gh("read the branches", async () => parseBranches((await ctx.github.read(branchesQueryArgs(repo, query), { repo, maxAgeSeconds: keepSeconds() })).stdout), ctx);
  },
} satisfies Op;
