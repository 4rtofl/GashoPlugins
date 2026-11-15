// Issues and pull requests of a repository with the words in their titles: { repo, query, fresh? } → ItemSummary[],
// the best match first (10 at most). One GraphQL query (1 point).
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { ItemSummary } from "../../types.ts";
import { gh, maxAge } from "../core.ts";
import { repoArg, summary, SUMMARY } from "../gh.ts";
import type { Op } from "../op.ts";

/** The words go into a variable of the query, never into the query itself. */
export function searchArgs(repo: string, words: string): string[] {
  const query = `query($q: String!) { search(query: $q, type: ISSUE, first: 10) { nodes { ${SUMMARY} } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `q=repo:${repo} in:title ${words}`];
}

/** Only `repo`'s: the words may name other repositories (repo:…), and a number is added to the worktree as one of `repo`. */
export function parseSearch(json: string, repo: string): ItemSummary[] {
  const nodes = (JSON.parse(json) as { data?: { search?: { nodes?: unknown[] } | null } }).data?.search?.nodes ?? [];
  const prefix = `https://github.com/${repo}/`.toLowerCase();
  return nodes.flatMap((n) => {
    const s = summary(n);
    return s && s.url.toLowerCase().startsWith(prefix) ? [s] : [];
  });
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const words = typeof p.query === "string" ? p.query.trim() : "";
    if (!words || words.length > 200 || /[\r\n]/.test(words)) throw new PluginError("探す語が正しくありません。");
    return gh("search issues and pull requests", async () => parseSearch((await ctx.github.read(searchArgs(repo, words), { repo, maxAgeSeconds: maxAge(p) })).stdout, repo), ctx);
  },
} satisfies Op;
