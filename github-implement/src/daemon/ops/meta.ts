// The repository's labels and the people who can be assigned, and gh's own login: { repo } → RepoMeta.
import type { RepoMeta } from "../../types.ts";
import { gh, KEEP_MAX_SECONDS } from "../core.ts";
import { labelColor, login, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

/** What is read, at most: a repository with as many may have more, which the pickers find by name. */
const LABELS_MAX = 200;
const ASSIGNABLE_MAX = 100;

export const labelsArgs = (repo: string): string[] => ["label", "list", "--repo", repo, "--limit", String(LABELS_MAX), "--json", "name,color"];
export const assignableArgs = (repo: string): string[] => ["api", `repos/${repo}/assignees?per_page=${ASSIGNABLE_MAX}`];
export const meArgs = ["api", "user"];

export function parseMeta(labelsJson: string, assignableJson: string, meJson: string | undefined): RepoMeta {
  const labels = (JSON.parse(labelsJson) as unknown[]).flatMap((l) => {
    const r = (l ?? {}) as Record<string, unknown>;
    const name = str(r.name);
    const color = labelColor(r.color);
    return name ? [{ name, ...(color ? { color } : {}) }] : [];
  });
  const assignable = (JSON.parse(assignableJson) as unknown[]).flatMap((u) => (login(u) ? [login(u) as string] : []));
  const me = meJson ? login(JSON.parse(meJson)) : undefined;
  return { labels, ...(labels.length >= LABELS_MAX ? { labelsMore: true } : {}), assignable, ...(assignable.length >= ASSIGNABLE_MAX ? { assignableMore: true } : {}), ...(me ? { me } : {}) };
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    return gh(
      "read labels and assignees",
      async (): Promise<RepoMeta> => {
        const [labels, assignable, me] = await Promise.all([
          ctx.github.read(labelsArgs(repo), { maxAgeSeconds: KEEP_MAX_SECONDS }),
          ctx.github.read(assignableArgs(repo), { maxAgeSeconds: KEEP_MAX_SECONDS }),
          ctx.github.read(meArgs, { maxAgeSeconds: KEEP_MAX_SECONDS }).catch(() => undefined),
        ]);
        return parseMeta(labels.stdout, assignable.stdout, me?.stdout);
      },
      ctx,
    );
  },
} satisfies Op;
