// The reviews of a pull request, also those that only hold comments on lines of the code (the conversation says how
// many, from ops/comments.ts, as gh does not read them).
import type { GitHubReview } from "../../types.ts";
import { clip, login, str, type DetailPart } from "../gh.ts";

const STATE: Record<string, GitHubReview["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

export default {
  fields: { pulls: ["reviews"] },
  read(raw, item) {
    item.reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).flatMap((r): GitHubReview[] => {
      const submittedAt = str(r?.submittedAt);
      const state = STATE[str(r?.state)?.toUpperCase() ?? ""];
      const body = str(r?.body) ?? "";
      if (!submittedAt || !state) return [];
      const id = str(r?.id);
      const author = login(r?.author);
      return [{ ...(id ? { id } : {}), ...(author ? { author } : {}), submittedAt, state, body: clip(body) }];
    });
  },
} satisfies DetailPart;
