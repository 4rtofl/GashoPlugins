// The commits of a pull request, oldest first (GitHub gives 250 at most).
import { str, type DetailPart } from "../gh.ts";

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
  }
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
