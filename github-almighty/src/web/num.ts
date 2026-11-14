// The number of an issue or pull request, as a person types it into the "GitHub" tab of a worktree.

/** "17", "#17", or a GitHub URL of an issue or pull request of `repo`. */
export function numberFrom(text: string, repo: string): number | undefined {
  const t = text.trim();
  const m = /^#?(\d{1,9})$/.exec(t) ?? new RegExp(`^https://github\\.com/${repo.replace(/[.]/g, "\\.")}/(?:issues|pull)/(\\d{1,9})(?:[/?#].*)?$`, "i").exec(t);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}
