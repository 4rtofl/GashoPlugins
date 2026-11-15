// The daemon part of the Git plugin: it reads a session's repository's open issues and pull requests, and one of
// them, with the working server's gh. The web part names the session and, in a folder of several repositories, the
// repository inside it; gasho-daemon turns these into the folder and its GitHub repository (ctx.session.repo), never
// into a path the browser made up.
import { defineDaemonPlugin, PluginError, type DaemonContext } from "@gasho/plugin-sdk/daemon";
import type { GitHubListKind, GitHubRepo } from "../types.ts";
import { ghError, listGitHub, viewGitHub } from "./gh.ts";

/** The list a call is about, and the GitHub repository of the session's folder (or of `repo` inside it). */
function where(params: unknown, ctx: DaemonContext): { kind: GitHubListKind; github: GitHubRepo; p: Record<string, unknown> } {
  const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
  if (p.kind !== "issues" && p.kind !== "pulls") throw new PluginError("一覧の種類（issues か pulls）が正しくありません。");
  if (!ctx.session) throw new PluginError("このセッションは見つかりません。");
  if (p.repo !== undefined && (typeof p.repo !== "string" || p.repo.length > 500)) throw new PluginError("リポジトリの指定が正しくありません。");
  const folder = ctx.session.repo(p.repo as string | undefined);
  if (!folder.github) throw new PluginError("このリポジトリは GitHub にありません（origin が GitHub のリポジトリではありません）。");
  return { kind: p.kind, github: folder.github, p };
}

export default defineDaemonPlugin({
  methods: {
    /** The open issues or pull requests: { kind, repo? }. */
    async list(params, ctx) {
      const { kind, github } = where(params, ctx);
      try {
        return await listGitHub(ctx, github, kind);
      } catch (e) {
        ctx.log(`gh could not list ${kind} of ${github.owner}/${github.name}`, e);
        throw new PluginError(ghError(e));
      }
    },
    /** One issue or pull request with its conversation: { kind, number, repo? }. */
    async item(params, ctx) {
      const { kind, github, p } = where(params, ctx);
      const n = p.number;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1e9) throw new PluginError("番号が正しくありません。");
      try {
        return await viewGitHub(ctx, github, kind, n);
      } catch (e) {
        ctx.log(`gh could not read ${kind} #${n} of ${github.owner}/${github.name}`, e);
        throw new PluginError(ghError(e));
      }
    },
  },
});
