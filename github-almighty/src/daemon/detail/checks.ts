// The checks and statuses of a pull request's latest commit (CI).
import type { GitHubCheck } from "../../types.ts";
import { httpsUrl, str, type DetailPart } from "../gh.ts";

/** A check run's or commit status's result, in a few words. */
export function checkState(c: { status?: unknown; conclusion?: unknown; state?: unknown }): GitHubCheck["state"] {
  const state = str(c.state)?.toUpperCase();
  if (state) {
    if (state === "SUCCESS") return "success";
    if (state === "FAILURE" || state === "ERROR") return "failure";
    return "pending";
  }
  if (str(c.status)?.toUpperCase() !== "COMPLETED") return "pending";
  switch (str(c.conclusion)?.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "NEUTRAL":
    case "STALE":
      return "neutral";
    default:
      return "failure";
  }
}

export default {
  fields: { pulls: ["statusCheckRollup"] },
  read(raw, item) {
    item.checks = (Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : []).flatMap((c): GitHubCheck[] => {
      const name = str(c?.name) ?? str(c?.context);
      if (!name) return [];
      const workflow = str(c?.workflowName);
      const link = httpsUrl(c?.detailsUrl) ?? httpsUrl(c?.targetUrl);
      return [{ name: workflow && workflow !== name ? `${workflow} / ${name}` : name, state: checkState(c ?? {}), ...(link ? { url: link } : {}) }];
    });
  },
} satisfies DetailPart;
