// The milestone of an issue or pull request.
import { num, str, type DetailPart } from "../gh.ts";

export interface GitHubMilestone {
  number: number;
  title: string;
  /** ISO 8601 */
  dueOn?: string;
}

declare module "../../types.ts" {
  interface GitHubItemDetail {
    milestone?: GitHubMilestone;
  }
}

/** A milestone as gh (dueOn) or GitHub's REST API (due_on) gives it. */
export function milestoneOf(raw: unknown): GitHubMilestone | undefined {
  const m = (raw ?? {}) as Record<string, unknown>;
  const number = num(m.number);
  const title = str(m.title);
  if (number === undefined || !title) return undefined;
  const dueOn = str(m.dueOn) ?? str(m.due_on);
  return { number, title, ...(dueOn ? { dueOn } : {}) };
}

export default {
  fields: { issues: ["milestone"], pulls: ["milestone"] },
  read(raw, item) {
    const m = milestoneOf(raw.milestone);
    if (m) item.milestone = m;
  },
} satisfies DetailPart;
