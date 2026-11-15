// The title and state of one issue or pull request of the repository, for the card over a #number in the
// conversation: { repo, number, fresh? } → ItemSummary, or null when GitHub does not have it. One GraphQL query (1 point).
import { gh, maxAge, readItems } from "../core.ts";
import { numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    const items = await gh(`read #${number}`, () => readItems(ctx, repo, undefined, [number], maxAge(p)), ctx);
    return items.added[0] ?? null;
  },
} satisfies Op;
