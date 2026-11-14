// Links an issue for a pull request to close when it is merged (linked: true), or takes a link made by hand off
// (false): { repo, number, issue, linked }. GitHub makes the change on the issue, by the node IDs of both; a link made by
// the body ("Closes #12") stays, as GitHub only takes it off with the body.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, KEEP_MAX_SECONDS } from "../core.ts";
import { numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

export function idsQueryArgs(repo: string, pull: number, issue: number): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query = "query($owner: String!, $name: String!, $pull: Int!, $issue: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pull) { id } issue(number: $issue) { id } } }";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `pull=${pull}`, "-F", `issue=${issue}`];
}

export function linkArgs(issueId: string, pullId: string, linked: boolean): string[] {
  const mutation = linked ? "addCloseIssueReferences" : "removeCloseIssueReferences";
  const query = `mutation($issue: ID!, $pull: ID!) { ${mutation}(input: {issueId: $issue, pullRequestIds: [$pull]}) { clientMutationId } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `issue=${issueId}`, "-f", `pull=${pullId}`];
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const pull = numberArg(p.number);
    const issue = numberArg(p.issue);
    if (typeof p.linked !== "boolean") throw new PluginError("足すか外すかの指定が正しくありません。");
    const linked = p.linked;
    await gh(
      `${linked ? "link" : "unlink"} #${issue} to #${pull}`,
      async () => {
        // Node IDs never change: they may come from what gasho-daemon kept.
        const ids = (JSON.parse((await ctx.github.read(idsQueryArgs(repo, pull, issue), { repo, maxAgeSeconds: KEEP_MAX_SECONDS })).stdout) as { data?: { repository?: { pullRequest?: { id?: unknown }; issue?: { id?: unknown } } } }).data?.repository;
        const pullId = str(ids?.pullRequest?.id);
        const issueId = str(ids?.issue?.id);
        if (!pullId || !issueId) throw new PluginError(`#${pull} の Pull request か #${issue} の Issue が見つかりません。`);
        await ctx.github.write(linkArgs(issueId, pullId, linked), { repo });
      },
      ctx,
    );
    return { ok: true };
  },
} satisfies Op;
