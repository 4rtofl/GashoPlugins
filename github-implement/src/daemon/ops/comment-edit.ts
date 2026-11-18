// A comment's new text: { repo, id, body }, with the comment's node id (ops/comments.ts).
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, withTextFile } from "../core.ts";
import { repoArg, textArg } from "../gh.ts";
import type { Op } from "../op.ts";
import { nodeIdArg } from "./comments.ts";

const MUTATION = "mutation($id: ID!, $body: String!) { updateIssueComment(input: { id: $id, body: $body }) { issueComment { id } } }";

/** `bodyFile`: a file with the comment (withTextFile), which gh api reads for a field given as -F <field>=@<file>. */
export const commentEditArgs = (id: string, bodyFile: string): string[] => ["api", "graphql", "-f", `query=${MUTATION}`, "-f", `id=${id}`, "-F", `body=@${bodyFile}`];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const id = nodeIdArg(p.id);
    const body = textArg(p.body, "コメント", 65_536);
    if (!body.trim()) throw new PluginError("コメントを空にはできません。消すときは削除してください。");
    await gh("edit a comment", () => withTextFile(body, (file) => ctx.github.write(commentEditArgs(id, file), { repo })), ctx);
    return { ok: true };
  },
} satisfies Op;
