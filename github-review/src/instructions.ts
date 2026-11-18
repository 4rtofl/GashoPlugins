// The instructions the page sends to the session in a review worktree, besides the templates: how to post the review
// (added at the end of the template sent when the worktree is made, so that a template changed in the settings never
// loses the verdict), and what "マージしてもらう", "差し戻す" and, on my own pull request, "修正してもらう" ask; and the
// effort level the session is switched to before each.
import type { EffortLevel, MachineInfo } from "@gasho/plugin-sdk";
import { canPush } from "./types.ts";
import type { ReviewMark } from "./verdict.ts";

export type MergeMethod = "merge" | "squash" | "rebase";

export const MERGE_METHODS: readonly MergeMethod[] = ["merge", "squash", "rebase"];

/** The setting "mergeMethod"; anything else is the default, merge. */
export const mergeMethodOf = (v: unknown): MergeMethod => (MERGE_METHODS.includes(v as MergeMethod) ? (v as MergeMethod) : "merge");

/** The heading of the comments the Agent posts: they go out under my GitHub account. */
export const REVIEW_HEADING = "## 🤖 Agent によるレビュー";

interface PrRef {
  repo: string;
  number: number;
  title: string;
  url: string;
  branch: string;
}

const gh = (pr: PrRef, args: string): string => `gh ${args.replace("{n}", String(pr.number))} --repo ${pr.repo}`;

/** What goes after the template sent when a review worktree is made: how to post the review, with its mark. */
export function markInstruction(pr: PrRef): string {
  return [
    "",
    "---",
    `レビューが終わったら、結果を Pull request #${pr.number} のコメントとして投稿してください（\`${gh(pr, "pr comment {n} --body-file <ファイル>")}\`）。`,
    `- コメントは私の GitHub アカウントで投稿されるので、1行目を「${REVIEW_HEADING}」にしてください。`,
    "- 最後の行に、次の印をそのまま1行で入れてください。verdict は、マージしてよければ mergeable、直すところがあれば changes にします。sha は、レビューした head の commit の SHA（40桁）です。" +
      `\`${gh(pr, "pr view {n} --json headRefOid -q .headRefOid")}\` で確かめてください。`,
    "  `<!-- gasho-review verdict=mergeable sha=<SHA> -->`",
    "- approve や request changes のレビューは付けないでください（あとで頼みます）。",
  ].join("\n");
}

export interface MergeOptions {
  method: MergeMethod;
  /** Delete the head branch after the merge (never one in a fork). */
  deleteBranch: boolean;
  /** My own pull request: GitHub does not let me approve it. */
  own: boolean;
  /** Its head is in a fork. */
  fork: boolean;
  /** The head can be pushed to (same repository, my own fork, or the maintainers may change it). */
  canPush: boolean;
}

/**
 * "マージしてもらう": take in the base on a conflict, wait for the checks, approve (not my own: GitHub does not let me),
 * then merge. The approval comes after the conflict, so that a resolution that changes the content leaves none.
 */
export function mergeInstruction(pr: PrRef, mark: ReviewMark, o: MergeOptions): string {
  const lines = [`${pr.url} の Pull request #${pr.number}「${pr.title}」をマージしてください。レビューの結果は ${mark.url} のコメントです。`, ""];
  const steps: string[] = [];
  steps.push(
    o.canPush
      ? `base とのコンフリクトがあるか確かめます（\`${gh(pr, "pr view {n} --json mergeable,mergeStateStatus")}\`）。あれば、この worktree で base のブランチを取り込み（rebase ではなく merge）、解決して、head のブランチ（${pr.branch}）に push します。` +
          "解決で変更の中身が変わったとき（どちらかの側の変更を書き換えた・捨てた・足したとき）は、マージせずに、何をどう解決したかを Pull request にコメントして、ここで終わりにしてください（もう一度レビューします）。"
      : `base とのコンフリクトがあるか確かめます（\`${gh(pr, "pr view {n} --json mergeable,mergeStateStatus")}\`）。この Pull request の head には push できないので、コンフリクトがあれば、マージせずに、そのことを伝えて終わりにしてください。`,
  );
  steps.push(`チェックが終わるのを待ちます（\`${gh(pr, "pr checks {n} --watch")}\`）。失敗したチェックがあれば、マージせずに、どれが失敗したかを伝えて終わりにしてください。`);
  steps.push(
    o.own
      ? "これは私の Pull request なので、approve はできません。approve せずに進めてください。"
      : `\`${gh(pr, "pr review {n} --approve --body-file <ファイル>")}\` で approve します。本文は、レビューの結果を1〜3行に要約したものにしてください。`,
  );
  steps.push(
    `\`${gh(pr, `pr merge {n} --${o.method} --match-head-commit <SHA>`)}\` でマージします。SHA は、push しなかったときはレビューした ${mark.sha}、コンフリクトを解決して push したときは、その commit です。` +
      "head が違うと言われたら（ほかの人が push した）、マージせずに、そのことを伝えて終わりにしてください。",
  );
  if (o.deleteBranch && !o.fork) {
    steps.push(
      `マージできたら、\`gh api -X DELETE repos/${pr.repo}/git/refs/heads/${pr.branch}\` で GitHub の head のブランチを消します（ローカルのブランチと worktree はそのままにしてください）。`,
    );
  }
  steps.push("終わったら、どうなったかを短く伝えてください。");
  lines.push(...steps.map((s, i) => `${i + 1}. ${s}`));
  return lines.join("\n");
}

/** "差し戻す": request changes, from the review's comment. */
export function sendBackInstruction(pr: PrRef, mark: ReviewMark): string {
  return [
    `${pr.url} の Pull request #${pr.number}「${pr.title}」を差し戻してください。`,
    `${mark.url} のレビュー結果のコメントを元に、\`${gh(pr, "pr review {n} --request-changes --body-file <ファイル>")}\` で request changes のレビューを付けます。` +
      "本文には、直してほしい点をそのコメントから要約して書き、そのコメントへのリンクも入れてください。",
    "自分で直したり push したりはしないでください。終わったら、そのことを短く伝えてください。",
  ].join("\n");
}

/** "修正してもらう": my own pull request cannot get request changes, so the Agent mends it instead. */
export function fixInstruction(pr: PrRef, mark: ReviewMark): string {
  return [
    `${pr.url} の Pull request #${pr.number}「${pr.title}」は私の Pull request なので、差し戻す代わりに直してください。`,
    `${mark.url} のレビュー結果のコメントで直すとされた点を、この worktree で直して commit し、head のブランチ（${pr.branch}）に push します。`,
    "push したあとは、もう一度レビューするまでマージしないでください。終わったら、何を直したかを短く伝えてください。",
  ].join("\n");
}

/** The review itself (the template sent when the worktree is made) is done at high. */
export const REVIEW_EFFORT: EffortLevel = "high";

/**
 * The effort level for a row's button: "マージしてもらう" and "差し戻す" only follow steps, so they need no more than
 * medium; "修正してもらう" mends the code, and keeps the session's (the review's high, unless changed since).
 */
export const askEffort = (kind: "merge" | "sendBack" | "fix"): EffortLevel | undefined => (kind === "fix" ? undefined : "medium");

/**
 * What to ask useSendInput to switch the effort level to: only where gasho-daemon can (it lists "effort" in
 * MachineInfo.features, 0.6.0 and later); elsewhere the text goes as it is.
 */
export const effortFor = (machine: Pick<MachineInfo, "features">, effort: EffortLevel | undefined): { effort?: EffortLevel } =>
  effort && machine.features?.includes("effort") ? { effort } : {};

/** The instruction of a row's button (verdict.ts `askOf`) for a pull request with the mark of its review. */
export function askInstruction(
  kind: "merge" | "sendBack" | "fix",
  pr: PrRef & { own?: boolean; fork?: boolean; canModify?: boolean },
  mark: ReviewMark,
  merge: { method: MergeMethod; deleteBranch: boolean },
): string {
  if (kind === "merge") return mergeInstruction(pr, mark, { ...merge, own: pr.own === true, fork: pr.fork === true, canPush: canPush(pr) });
  return kind === "fix" ? fixInstruction(pr, mark) : sendBackInstruction(pr, mark);
}
