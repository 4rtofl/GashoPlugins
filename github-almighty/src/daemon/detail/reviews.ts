// The reviews of a pull request that have text of their own.
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
    // Reviews that only hold comments on lines of the code have no text of their own; those are left out.
    item.reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).flatMap((r): GitHubReview[] => {
      const submittedAt = str(r?.submittedAt);
      const state = STATE[str(r?.state)?.toUpperCase() ?? ""];
      const body = str(r?.body) ?? "";
      if (!submittedAt || !state || (state === "commented" && !body.trim())) return [];
      const author = login(r?.author);
      return [{ ...(author ? { author } : {}), submittedAt, state, body: clip(body) }];
    });
  },
} satisfies DetailPart;
