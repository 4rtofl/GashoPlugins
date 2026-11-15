// One issue or pull request with its conversation: { repo, kind, number, fresh? } → GitHubItemDetail.
import { gh, readDetail } from "../core.ts";
import { kindArg, numberArg, repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const kind = kindArg(p.kind);
    const number = numberArg(p.number);
    return gh(`read ${kind} #${number}`, () => readDetail(ctx, repo, kind, number, p), ctx);
  },
} satisfies Op;
