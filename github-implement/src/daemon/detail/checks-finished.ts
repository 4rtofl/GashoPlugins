// When the checks and statuses of a pull request's latest commit finished, for the count of those that finished since
// its tab was last open (src/news.ts).
import { str, type DetailPart } from "../gh.ts";

declare module "../../types.ts" {
  interface GitHubItemDetail {
    /** Pull requests only: ISO 8601, one per check or status that has finished. */
    checksFinishedAt?: string[];
  }
}

/** A commit status's time once it has a result (a new status takes the place of the old one), or a check run's end. */
function finishedAt(c: Record<string, unknown>): string | undefined {
  const state = str(c.state)?.toUpperCase();
  if (state) return ["SUCCESS", "FAILURE", "ERROR"].includes(state) ? str(c.startedAt) : undefined;
  // A check run that has not finished has completedAt "0001-01-01T00:00:00Z".
  return str(c.status)?.toUpperCase() === "COMPLETED" ? str(c.completedAt) : undefined;
}

export default {
  fields: { pulls: ["statusCheckRollup"] },
  read(raw, item) {
    item.checksFinishedAt = (Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : []).flatMap((c) => {
      const at = finishedAt((c ?? {}) as Record<string, unknown>);
      return at ? [at] : [];
    });
  },
} satisfies DetailPart;
