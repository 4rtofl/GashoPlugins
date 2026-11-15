// The repositories the page "GitHub" of the sidebar offers (page.tsx), and the worktree each one's items open in.
import type { MachineInfo, SessionInfo } from "@gasho/plugin-sdk";

export interface RepoPlace {
  /** <machine>:<owner/name> */
  key: string;
  machine: MachineInfo;
  /** owner/name */
  repo: string;
  url: string;
  /** The worktree the items open in. */
  path: string;
}

const lastUsed = (s: SessionInfo): number => s.lastActivityAt ?? s.startedAt ?? 0;

/** The repositories on GitHub of every working server: registered ones first, in their order, then those of sessions. */
export function repoPlaces(machines: MachineInfo[]): RepoPlace[] {
  const out = new Map<string, RepoPlace>();
  const add = (machine: MachineInfo, github: { owner: string; name: string; url: string }, path: string) => {
    const repo = `${github.owner}/${github.name}`;
    const key = `${machine.id}:${repo}`;
    if (!out.has(key)) out.set(key, { key, machine, repo, url: github.url, path });
  };
  for (const m of machines) {
    for (const r of m.repos ?? []) if (r.github && !r.error) add(m, r.github, r.worktrees[0]?.path ?? r.path);
    for (const s of [...m.sessions].sort((a, b) => lastUsed(b) - lastUsed(a))) if (s.managed && s.github && s.worktree) add(m, s.github, s.worktree.path);
  }
  return [...out.values()];
}
