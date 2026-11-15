// The daemon part of the GitHub plugin: it reads a session's repository's Actions, Projects and Packages with the
// working server's gh, through gasho-daemon (ctx.github.read, plugin API 1.3). Every method only reads. The web part
// names the session and, in a folder of several repositories, the repository inside it; gasho-daemon turns these into
// the folder's GitHub repository (ctx.session.repo), whose owner/name is checked before it goes to gh as --repo.
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import type { Board, GitHubRepo, PackageDetail, Packages, Projects, RunDetail, Runs } from "../types.ts";
import { listRuns, viewRun } from "./actions.ts";
import { branchArg, ghError, idArg, maxAge, missingScope, objArg, repoOf } from "./gh.ts";
import { listPackages, packageNameArg, packageTypeArg, readPackage } from "./packages.ts";
import { listProjects, readBoard } from "./projects.ts";

/** The GitHub repository of the session's folder (or of `repo` inside it), and the params. */
function where(params: unknown, ctx: DaemonContext): { github: GitHubRepo; repo: string; p: Record<string, unknown> } {
  const p = objArg(params);
  if (!ctx.session) throw new PluginError("このセッションは見つかりません。");
  if (p.repo !== undefined && (typeof p.repo !== "string" || p.repo.length > 500)) throw new PluginError("リポジトリの指定が正しくありません。");
  const folder = ctx.session.repo(p.repo as string | undefined);
  if (!folder.github) throw new PluginError("このリポジトリは GitHub にありません（origin が GitHub のリポジトリではありません）。");
  return { github: folder.github, repo: repoOf(folder.github), p };
}

/** Runs `read`, and turns gh's failures into a message for the person. */
async function reading<T>(ctx: DaemonContext, what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof PluginError) throw e;
    ctx.log(`gh could not read ${what}`, e);
    throw new PluginError(ghError(e));
  }
}

export default defineDaemonPlugin({
  methods: {
    /** The runs of the repository, newest first: { repo?, workflow?, branch?, fresh? } → Runs. */
    async runs(params, ctx): Promise<Runs> {
      const { github, repo, p } = where(params, ctx);
      const workflow = p.workflow === undefined || p.workflow === "" ? undefined : idArg(p.workflow, "ワークフローの指定");
      const branch = branchArg(p.branch);
      return { repo: github, ...(await reading(ctx, `the runs of ${repo}`, () => listRuns(ctx, repo, { workflow, branch, maxAgeSeconds: maxAge(p, 10) }))) };
    },
    /** One run with its jobs and steps: { repo?, id, fresh? } → RunDetail. */
    async run(params, ctx): Promise<RunDetail> {
      const { repo, p } = where(params, ctx);
      const id = idArg(p.id, "実行の番号");
      return reading(ctx, `run ${id} of ${repo}`, () => viewRun(ctx, repo, id, { maxAgeSeconds: maxAge(p, 10) }));
    },
    /** The projects linked to the repository and its owner's others: { repo?, fresh? } → Projects. */
    async projects(params, ctx): Promise<Projects> {
      const { github, repo, p } = where(params, ctx);
      return { repo: github, ...(await reading(ctx, `the projects of ${repo}`, () => listProjects(ctx, repo, { maxAgeSeconds: maxAge(p, 60) }))) };
    },
    /** One project of the repository's owner as a board: { repo?, number, fresh? } → Board. */
    async project(params, ctx): Promise<Board> {
      const { github, repo, p } = where(params, ctx);
      const number = idArg(p.number, "Project の番号");
      const board = await reading(ctx, `project ${number} of ${github.owner}`, () => readBoard(ctx, repo, number, { maxAgeSeconds: maxAge(p, 30) }));
      if (!board) throw new PluginError(`${github.owner} の Project #${number} は見つかりません。`);
      return { repo: github, ...board };
    },
    /** The packages of the repository: { repo?, fresh? } → Packages. */
    async packages(params, ctx): Promise<Packages> {
      const { github, repo, p } = where(params, ctx);
      return { repo: github, ...(await reading(ctx, `the packages of ${repo}`, () => listPackages(ctx, repo, { maxAgeSeconds: maxAge(p, 60) }))) };
    },
    /** One package of the repository with its versions: { repo?, type, name, fresh? } → PackageDetail. */
    async package(params, ctx): Promise<PackageDetail> {
      const { github, repo, p } = where(params, ctx);
      const type = packageTypeArg(p.type);
      const name = packageNameArg(p.name);
      if (!type || !name) throw new PluginError("パッケージの指定が正しくありません。");
      try {
        const pkg = await readPackage(ctx, repo, type, name, { maxAgeSeconds: maxAge(p, 60) });
        if (!pkg) throw new PluginError(`このリポジトリのパッケージ ${name} は見つかりません。`);
        return { repo: github, ...pkg };
      } catch (e) {
        const missing = missingScope(e);
        if (missing) {
          return { repo: github, package: { type, name, visibility: "", url: `${github.url}/packages` }, versions: [], truncated: false, missing };
        }
        if (e instanceof PluginError) throw e;
        ctx.log(`gh could not read package ${type}/${name} of ${repo}`, e);
        throw new PluginError(ghError(e));
      }
    },
  },
});
