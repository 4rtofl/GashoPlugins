// The commits of a pull request, oldest first: gh reads the oldest GH_COMMITS and no more, so how many there are is
// read apart (commitsCountArgs) when it gave that many.
import { num, str, type DetailPart } from "../gh.ts";

export interface GitHubCommit {
  oid: string;
  /** The first line of its message. */
  headline: string;
  author?: string;
  /** ISO 8601 */
  committedAt: string;
}

declare module "../../types.ts" {
  interface GitHubItemDetail {
    /** Pull requests only. */
    commits?: GitHubCommit[];
    /** How many commits it has, read only when gh gave GH_COMMITS of them. */
    commitsTotal?: number;
  }
}

/** gh pr view's `commits(first: 100)`. */
export const GH_COMMITS = 100;

/** How many commits the pull request has (1 point). */
export function commitsCountArgs(repo: string, number: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { commits { totalCount } } } }";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

export function parseCommitsCount(json: string): number | undefined {
  const data = JSON.parse(json) as { data?: { repository?: { pullRequest?: { commits?: { totalCount?: unknown } } | null } | null } };
  return num(data.data?.repository?.pullRequest?.commits?.totalCount);
}

export default {
  fields: { pulls: ["commits"] },
  read(raw, item) {
    item.commits = (Array.isArray(raw.commits) ? raw.commits : []).flatMap((c): GitHubCommit[] => {
      const oid = str(c?.oid);
      if (!oid || !/^[0-9a-f]{40}$/.test(oid)) return [];
      const first = Array.isArray(c?.authors) ? c.authors[0] : undefined;
      const author = str(first?.login) || str(first?.name);
      return [{ oid, headline: str(c?.messageHeadline) ?? "", ...(author ? { author } : {}), committedAt: str(c?.committedDate) ?? "" }];
    });
  },
} satisfies DetailPart;
