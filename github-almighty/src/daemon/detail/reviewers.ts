// The reviewers of a pull request and where each stands: the ones asked for a review and not yet answered, then the
// ones who reviewed, with what they decided last.
import { login, str, type DetailPart } from "../gh.ts";

export interface GitHubReviewer {
  /** A login, or a team as org/slug (what gh's --add-reviewer and --remove-reviewer take). */
  name: string;
  team?: true;
  /** requested: asked and not reviewed since. */
  state: "requested" | "approved" | "changes_requested" | "commented" | "dismissed";
}

declare module "../../types.ts" {
  interface GitHubItemDetail {
    /** Pull requests only. */
    reviewers?: GitHubReviewer[];
  }
}

type Reviewed = Exclude<GitHubReviewer["state"], "requested">;

const DECISION: Record<string, Reviewed> = { APPROVED: "approved", CHANGES_REQUESTED: "changes_requested", DISMISSED: "dismissed" };

/**
 * Where each reviewer stands, as GitHub's sidebar shows it: a request not answered yet comes first (GitHub drops it
 * when they review, and has it again when they are asked again), and a review that only comments does not take back
 * an approval or a request for changes. The author's own reviews are left out; pending ones are not sent yet.
 */
export function reviewersOf(raw: Record<string, unknown>, author: string | undefined, owner: string): GitHubReviewer[] {
  const requested = (Array.isArray(raw.reviewRequests) ? raw.reviewRequests : []).flatMap((r): GitHubReviewer[] => {
    if (r?.__typename === "Team") {
      // gh gives a team's slug as org/slug; the team is always of the repository's owner.
      const slug = str(r.slug);
      return slug ? [{ name: slug.includes("/") ? slug : `${owner}/${slug}`, team: true, state: "requested" }] : [];
    }
    const name = str(r?.login);
    return name ? [{ name, state: "requested" }] : [];
  });
  const asked = new Set(requested.map((r) => r.name));
  const last = new Map<string, { decided?: Reviewed; commented: boolean }>();
  const reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).filter((r) => str(r?.submittedAt));
  reviews.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  for (const r of reviews) {
    const who = login(r?.author);
    const state = str(r?.state)?.toUpperCase();
    if (!who || who === author || asked.has(who)) continue;
    const seen = last.get(who) ?? { commented: false };
    if (state && DECISION[state]) seen.decided = DECISION[state];
    else if (state === "COMMENTED") seen.commented = true;
    else continue;
    last.set(who, seen);
  }
  const reviewed = [...last].map(([name, s]): GitHubReviewer => ({ name, state: s.decided ?? "commented" }));
  return [...requested, ...reviewed];
}

export default {
  fields: { pulls: ["reviewRequests", "reviews"] },
  read(raw, item) {
    const owner = /^https:\/\/github\.com\/([^/]+)\//.exec(item.url)?.[1] ?? "";
    item.reviewers = reviewersOf(raw, item.author, owner);
  },
} satisfies DetailPart;
