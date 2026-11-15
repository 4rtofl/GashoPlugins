// Gives a reaction to the body or a comment, or takes it back: { repo, subject, content, add }, with the node id of the
// issue, pull request or comment (ops/comments.ts) and one of REACTIONS.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { repoArg } from "../gh.ts";
import type { Op } from "../op.ts";
import { nodeIdArg, REACTIONS, type ReactionContent } from "./comments.ts";

export function reactionArgs(subject: string, content: ReactionContent, add: boolean): string[] {
  const field = add ? "addReaction" : "removeReaction";
  const mutation = `mutation($subject: ID!, $content: ReactionContent!) { ${field}(input: { subjectId: $subject, content: $content }) { reaction { content } } }`;
  return ["api", "graphql", "-f", `query=${mutation}`, "-f", `subject=${subject}`, "-f", `content=${content}`];
}

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const subject = nodeIdArg(p.subject);
    const content = p.content;
    if (typeof content !== "string" || !(REACTIONS as readonly string[]).includes(content)) throw new PluginError("リアクションの種類が正しくありません。");
    if (typeof p.add !== "boolean") throw new PluginError("付けるか外すかの指定が正しくありません。");
    const add = p.add;
    await gh(`${add ? "add" : "remove"} a reaction`, () => ctx.github.write(reactionArgs(subject, content as ReactionContent, add), { repo }), ctx);
    return { ok: true };
  },
} satisfies Op;
