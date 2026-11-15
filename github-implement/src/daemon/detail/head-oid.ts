// The commit at the head of a pull request (headRefOid): the merged section passes it to gasho-daemon as pushed, so a
// worktree whose commits go up to it is removed without asking more, even after a squash merge deleted the branch.
import { str, type DetailPart } from "../gh.ts";

declare module "../../types.ts" {
  interface GitHubItemDetail {
    /** Pull requests only: the SHA of the head commit as GitHub has it. */
    headOid?: string;
  }
}

export default {
  fields: { pulls: ["headRefOid"] },
  read(raw, item) {
    const oid = str(raw.headRefOid);
    if (oid && /^[0-9a-f]{40,64}$/i.test(oid)) item.headOid = oid.toLowerCase();
  },
} satisfies DetailPart;
