// Whether an issue is pinned to the top of its repository's issues.
import type { DetailPart } from "../gh.ts";

declare module "../../types.ts" {
  interface GitHubItemDetail {
    /** Issues only. */
    pinned?: boolean;
  }
}

export default {
  fields: { issues: ["isPinned"] },
  read(raw, item) {
    if (raw.isPinned === true) item.pinned = true;
  },
} satisfies DetailPart;
