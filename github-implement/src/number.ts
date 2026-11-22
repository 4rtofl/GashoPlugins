// The number of an issue or pull request in a branch's name, which both parts read, and as a person types it into the
// "GitHub" tab of a worktree.

/** The issue or pull request a branch is named after: feat/17-… and fix/17-… are #17. */
export function branchNumber(branch: string | undefined): number | undefined {
  const m = /^[a-z]+\/(\d+)-/.exec(branch ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 1e9 ? n : undefined;
}

/**
 * "17", "#17", or a GitHub URL of an issue or pull request of `repo` (http:// too, which GitHub sends to https://);
 * full-width "１７" and "＃１７" as well.
 */
export function numberFrom(text: string, repo: string): number | undefined {
  const t = text.normalize("NFKC").trim();
  const m = /^#?(\d{1,9})$/.exec(t) ?? new RegExp(`^https?://github\\.com/${repo.replace(/[.]/g, "\\.")}/(?:issues|pull)/(\\d{1,9})(?:[/?#].*)?$`, "i").exec(t);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/**
 * What a person typed into the box, when it is a number or a URL: the number, or why it cannot be added. Undefined: words
 * of a title, which are searched.
 */
export function typedItem(text: string, repo: string): { number: number } | { wrong: string } | undefined {
  const t = text.trim();
  const number = numberFrom(t, repo);
  if (number !== undefined) return { number };
  if (/^#?[-+]?\d+$/.test(t)) return { wrong: "番号は 1 から 999999999 までの数で入れてください。" };
  const other = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/\d+/i.exec(t);
  if (other?.[1] && other[1].toLowerCase() !== repo.toLowerCase()) return { wrong: `${other[1]} の URL です。この worktree に足せるのは ${repo} の Issue と Pull request です。` };
  if (/^https?:\/\//i.test(t)) return { wrong: `${repo} の Issue か Pull request の URL を入れてください。` };
  return undefined;
}
