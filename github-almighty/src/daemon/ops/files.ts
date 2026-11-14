// The files a pull request changes, each added, modified, removed or renamed, with the lines it adds and takes away:
// { repo, number, fresh? } → GitHubFile[], in GitHub's order. GitHub's REST API, since `gh pr view --json files` does
// not say how a file changed; 100 files a call, read when the tab of files shows, not in the background.
import { createHash } from "node:crypto";
import type { GitHubFile } from "../../types.ts";
import { gh, maxAge } from "../core.ts";
import { num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

const PER_PAGE = 100;
/** The first 300 files: the tab says how many more there are, to be seen on GitHub. */
const PAGES = 3;

/** One page; only the fields used, as each file comes with its patch. */
export function filesArgs(repo: string, number: number, page: number): string[] {
  return ["api", `repos/${repo}/pulls/${number}/files?per_page=${PER_PAGE}&page=${page}`, "--jq", "[.[] | {filename, status, previous_filename, additions, deletions}]"];
}

const STATUS: Record<string, GitHubFile["status"]> = { added: "added", copied: "added", removed: "removed", renamed: "renamed" };

export function parseFiles(json: string): GitHubFile[] {
  const raw = JSON.parse(json) as unknown;
  return (Array.isArray(raw) ? raw : []).flatMap((f): GitHubFile[] => {
    const path = str(f?.filename);
    if (!path) return [];
    const status = STATUS[str(f?.status) ?? ""] ?? "modified";
    const previousPath = status === "renamed" ? str(f?.previous_filename) : undefined;
    return [
      {
        path,
        status,
        ...(previousPath ? { previousPath } : {}),
        additions: num(f?.additions) ?? 0,
        deletions: num(f?.deletions) ?? 0,
        anchor: `diff-${createHash("sha256").update(path).digest("hex")}`,
      },
    ];
  });
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(
      `read the files of #${number}`,
      async () => {
        const files: GitHubFile[] = [];
        for (let page = 1; page <= PAGES; page++) {
          const got = parseFiles((await ctx.github.read(filesArgs(repo, number, page), { repo, maxAgeSeconds: maxAge(p) })).stdout);
          files.push(...got);
          if (got.length < PER_PAGE) break;
        }
        return files;
      },
      ctx,
    );
  },
} satisfies Op;
