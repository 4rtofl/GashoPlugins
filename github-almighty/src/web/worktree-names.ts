// The names a worktree for an issue or a pull request gets (item/sections/worktree.tsx): its branch and its folder.

/** Words of the title that can go into a branch name: the latin letters and digits, the first few. */
export function slug(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let out = "";
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 30) break;
    out = next;
  }
  return out;
}

export const issueBranch = (number: number, title: string): string => `feat/${number}-${slug(title) || "work"}`;

/** Beside the repository's folder: /home/me/repos/Gasho and feat/17-x give /home/me/repos/Gasho-17-x. */
export function worktreePath(repoFolder: string, branch: string): string {
  const last = (branch.split("/").pop() ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  return last ? `${repoFolder}-${last}` : repoFolder;
}

/** The issue a branch is named after: feat/17-… and fix/17-… are #17. */
export const branchNumber = (branch: string | undefined): number | undefined => {
  const m = /^[a-z]+\/(\d+)-/.exec(branch ?? "");
  return m ? Number(m[1]) : undefined;
};
