// What the conversation needs of the body and the comments besides gh's read of the item, which does not tell which
// comments bots wrote (its authors are logins only) or which reactions gh's login gave: the node ids the changes name
// them by, those, and whether gh's login may change each comment: { repo, number, fresh? } → ConversationMeta. One
// GraphQL query (1 point) per 100 comments, the latest ones as many as the item's read keeps; read when the
// conversation shows, not in the background.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, maxAge, type Ctx } from "../core.ts";
import { COMMENTS_MAX } from "../detail/comments.ts";
import { num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

/** GitHub's reactions, in the order GitHub shows them. */
export const REACTIONS = ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"] as const;
export type ReactionContent = (typeof REACTIONS)[number];

/** A reaction someone gave: how many gave it, and whether gh's login is one of them. */
export interface Reaction {
  content: ReactionContent;
  count: number;
  mine: boolean;
}

export interface CommentMeta {
  /** As GitHubComment's url: what the screen finds the comment by. */
  url: string;
  /** The node id the changes name it by. */
  id: string;
  bot: boolean;
  /** gh's login wrote it, and GitHub lets it change or delete it now (not when the conversation is locked, …). */
  editable: boolean;
  deletable: boolean;
  reactions: Reaction[];
}

export interface ConversationMeta {
  /** The issue's or pull request's node id: what the body's reactions are given to. */
  id: string;
  /** The body's reactions. */
  reactions: Reaction[];
  /** Oldest first. */
  comments: CommentMeta[];
}

/** A node id of GraphQL, as this read gives them (IC_kwDO…, or the older base64 ones). */
export function nodeIdArg(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_+/=-]{4,200}$/.test(v)) throw new PluginError("コメントなどの指定が正しくありません。");
  return v;
}

const PAGE = 100;
const GROUPS = "reactionGroups { content viewerHasReacted reactors { totalCount } }";
const COMMENT = `id url author { __typename } viewerDidAuthor viewerCanUpdate viewerCanDelete ${GROUPS}`;
const SUBJECT = `id ${GROUPS} comments(last: ${PAGE}, before: $before) { pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT} } }`;

/** A page of the latest comments, before `before` (a cursor of the page after it). */
export function commentsQueryArgs(repo: string, number: number, before?: string): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query =
    "query($owner: String!, $name: String!, $number: Int!, $before: String) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { " +
    `... on Issue { ${SUBJECT} } ... on PullRequest { ${SUBJECT} } } } }`;
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`, ...(before ? ["-f", `before=${before}`] : [])];
}

const CONTENTS = new Set<string>(REACTIONS);

/** Only the reactions someone gave, in GitHub's order. */
function reactionsOf(groups: unknown): Reaction[] {
  const given = (Array.isArray(groups) ? groups : []).flatMap((g): Reaction[] => {
    const r = (g ?? {}) as Record<string, unknown>;
    const content = str(r.content);
    const count = num((r.reactors as Record<string, unknown> | null)?.totalCount) ?? 0;
    return content && CONTENTS.has(content) && count > 0 ? [{ content: content as ReactionContent, count, mine: r.viewerHasReacted === true }] : [];
  });
  return given.sort((a, b) => REACTIONS.indexOf(a.content) - REACTIONS.indexOf(b.content));
}

/** A page of commentsQueryArgs: the item, its comments oldest first, and the cursor of the page before when there is one. */
export function parseComments(json: string): { meta: ConversationMeta; before?: string } | undefined {
  const data = JSON.parse(json) as { data?: { repository?: { issueOrPullRequest?: Record<string, unknown> | null } | null } };
  const subject = data.data?.repository?.issueOrPullRequest;
  const id = str(subject?.id);
  if (!subject || !id) return undefined;
  const page = (subject.comments ?? {}) as { pageInfo?: { hasPreviousPage?: unknown; startCursor?: unknown }; nodes?: unknown[] };
  const comments = (page.nodes ?? []).flatMap((raw): CommentMeta[] => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const url = str(c.url);
    const cid = str(c.id);
    if (!url || !cid) return [];
    const mine = c.viewerDidAuthor === true;
    return [
      {
        url,
        id: cid,
        bot: (c.author as Record<string, unknown> | null)?.__typename === "Bot",
        editable: mine && c.viewerCanUpdate === true,
        deletable: mine && c.viewerCanDelete === true,
        reactions: reactionsOf(c.reactionGroups),
      },
    ];
  });
  const before = page.pageInfo?.hasPreviousPage === true ? str(page.pageInfo.startCursor) : undefined;
  return { meta: { id, reactions: reactionsOf(subject.reactionGroups), comments }, ...(before ? { before } : {}) };
}

export async function readComments(ctx: Ctx, repo: string, number: number, maxAgeSeconds: number): Promise<ConversationMeta> {
  let meta: ConversationMeta | undefined;
  let before: string | undefined;
  do {
    const { stdout } = await ctx.github.read(commentsQueryArgs(repo, number, before), { repo, maxAgeSeconds });
    const page = parseComments(stdout);
    if (!page) throw new PluginError("この番号の Issue や Pull request は見つかりません。");
    meta = meta ? { ...meta, comments: [...page.meta.comments, ...meta.comments] } : page.meta;
    before = page.before;
  } while (before && meta.comments.length < COMMENTS_MAX);
  return meta;
}

export default {
  kind: "read",
  async run(p, ctx) {
    const repo = repoArg(p.repo);
    const number = numberArg(p.number);
    return gh(`read the comments of #${number}`, () => readComments(ctx, repo, number, maxAge(p)), ctx);
  },
} satisfies Op;
