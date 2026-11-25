// The daemon part of the GitHub plugin: it reads a session's repository's Actions, Projects and Packages with the
// working server's gh, through gasho-daemon (ctx.github.read, plugin API 1.3). Every method only reads. The web part
// names the session and, in a folder of several repositories, the repository inside it; gasho-daemon turns these into
// the folder's GitHub repository (ctx.session.repo), whose owner/name is checked before it goes to gh as --repo.
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import type { Board, GitHubRepo, PackageDetail, Packages, Projects, RunDetail, Runs } from "../types.ts";
import { listRuns, viewRun } from "./actions.ts";
import { branchArg, errorText, ghError, idArg, maxAge, missingScope, objArg, repoOf } from "./gh.ts";
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

/** What GitHub says when it has no run, project or package of the number or name asked for. */
const NOT_FOUND = { run: /failed to get run: HTTP 404/, project: /Could not resolve to a ProjectV2/, package: /Package not found/ };

/** Runs `read`, and turns gh's failures into a message for the person (`notFound` when GitHub has no such thing). */
async function reading<T>(ctx: DaemonContext, what: string, read: () => Promise<T>, notFound?: { when: RegExp; message: string }): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof PluginError) throw e;
    if (notFound?.when.test(errorText(e))) throw new PluginError(notFound.message);
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
    /** One run with its jobs and steps, at its latest attempt or at `attempt`: { repo?, id, attempt?, fresh? } → RunDetail. */
    async run(params, ctx): Promise<RunDetail> {
      const { repo, p } = where(params, ctx);
      const id = idArg(p.id, "実行の番号");
      const attempt = p.attempt === undefined || p.attempt === "" ? undefined : idArg(p.attempt, "実行の回");
      return reading(ctx, `run ${id} of ${repo}`, () => viewRun(ctx, repo, id, { attempt, maxAgeSeconds: maxAge(p, 10) }), {
        when: NOT_FOUND.run,
        message: attempt ? `この実行（ID ${id}）の ${attempt} 回目は見つかりません。` : `この実行（ID ${id}）は見つかりません。`,
      });
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
      const missing = `${github.owner} の Project #${number} は見つかりません。`;
      const board = await reading(ctx, `project ${number} of ${github.owner}`, () => readBoard(ctx, repo, number, { maxAgeSeconds: maxAge(p, 30) }), {
        when: NOT_FOUND.project,
        message: missing,
      });
      if (!board) throw new PluginError(missing);
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
      const missingPackage = `このリポジトリのパッケージ ${name} は見つかりません。`;
      try {
        const pkg = await readPackage(ctx, repo, type, name, { maxAgeSeconds: maxAge(p, 60) });
        if (!pkg) throw new PluginError(missingPackage);
        return { repo: github, ...pkg };
      } catch (e) {
        const missing = missingScope(e);
        if (missing) {
          return { repo: github, package: { type, name, visibility: "", url: `${github.url}/packages` }, versions: [], truncated: false, missing };
        }
        if (e instanceof PluginError) throw e;
        if (NOT_FOUND.package.test(errorText(e))) throw new PluginError(missingPackage);
        ctx.log(`gh could not read package ${type}/${name} of ${repo}`, e);
        throw new PluginError(ghError(e));
      }
    },
  },
});
