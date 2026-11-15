// The failed jobs of a workflow run of GitHub Actions, run again with the jobs that need them: { repo, run }. All of
// them at once, as GitHub runs no job of a run again while another job of it runs.
import { setTimeout as sleep } from "node:timers/promises";
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh } from "../core.ts";
import { actionsIdArg } from "../detail/checks.ts";
import { repoArg } from "../gh.ts";
import type { Op } from "../op.ts";

export const rerunArgs = (repo: string, run: number): string[] => ["run", "rerun", String(run), "--failed", "--repo", repo];
const jobsArgs = (repo: string, run: number): string[] => ["api", `repos/${repo}/actions/runs/${run}/jobs?filter=latest&per_page=100`];

/** Seconds to wait for the jobs run again to show on GitHub. */
const WAIT_SECONDS = 10;

export default {
  kind: "write",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const run = actionsIdArg(p.run);
    await gh(
      `run the failed jobs of run ${run} again`,
      async () => {
        try {
          await ctx.github.write(rerunArgs(repo, run), { repo });
        } catch (e) {
          const stderr = (e as { stderr?: unknown } | null)?.stderr;
          if (typeof stderr === "string" && /already running/i.test(stderr)) throw new PluginError("このワークフローのほかのジョブが、まだ動いています。終わってから再実行してください。");
          throw e;
        }
      },
      ctx,
    );
    // GitHub answers before the jobs are queued, and until they are, the pull request's checks leave them out or show
    // them failed. The screen reads the checks again when this returns.
    try {
      for (let i = 0; i < WAIT_SECONDS; i++) {
        await sleep(1000, undefined, { signal: ctx.signal });
        const { stdout } = await ctx.github.read(jobsArgs(repo, run), { maxAgeSeconds: 0 });
        const jobs = (JSON.parse(stdout) as { jobs?: { status?: unknown }[] }).jobs ?? [];
        if (jobs.some((j) => j.status !== "completed")) break;
      }
    } catch (e) {
      ctx.log(`could not see run ${run} start again`, e);
    }
    return { ok: true };
  },
} satisfies Op;
