// Deletes a comment: { repo, id }, with the comment's node id (ops/comments.ts). GitHub cannot bring it back.
import { gh } from "../core.ts";
import { repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import { nodeIdArg } from "./comments.ts";

const MUTATION = "mutation($id: ID!) { deleteIssueComment(input: { id: $id }) { clientMutationId } }";

export const commentDeleteArgs = (id: string): string[] => ["api", "graphql", "-f", `query=${MUTATION}`, "-f", `id=${id}`];

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const id = nodeIdArg(p.id);
    await gh("delete a comment", () => ctx.github.write(commentDeleteArgs(id), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
