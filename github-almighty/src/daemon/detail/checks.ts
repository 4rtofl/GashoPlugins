// The checks and statuses of a pull request's latest commit (CI).
import { PluginError } from "@gasho/plugin-sdk/daemon";
import type { GitHubCheck } from "../../types.ts";
import { httpsUrl, str, type DetailPart } from "../gh.ts";

declare module "../../types.ts" {
  interface GitHubCheck {
    /** A job of GitHub Actions: its workflow run and the job, whose log the screen reads and whose run it runs again. */
    run?: number;
    job?: number;
  }
}

/** The run and the job of a check of GitHub Actions, from its link (…/actions/runs/<run>/job/<job>); other checks have none. */
export function actionsJob(url: string | undefined): { run: number; job: number } | undefined {
  const m = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d{1,15})\/job\/(\d{1,15})(?:[/?#]|$)/.exec(url ?? "");
  return m ? { run: Number(m[1]), job: Number(m[2]) } : undefined;
}

/** The id of a run or a job from the browser: they are past 10^9, which numberArg does not take. */
export function actionsIdArg(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw new PluginError("GitHub Actions の実行の指定が正しくありません。");
  return v;
}

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
      return [{ name: workflow && workflow !== name ? `${workflow} / ${name}` : name, state: checkState(c ?? {}), ...(link ? { url: link } : {}), ...actionsJob(link) }];
    });
  },
} satisfies DetailPart;
