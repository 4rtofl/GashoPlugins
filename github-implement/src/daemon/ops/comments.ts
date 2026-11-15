// What the conversation needs of the body, the comments and the reviews besides gh's read of the item, which does not
// tell which comments bots wrote (its authors are logins only), which reactions gh's login gave or who gave them: the
// node ids the changes name them by, those, and whether gh's login may change each comment:
// { repo, number, kind?, fresh? } → ConversationMeta. One GraphQL query per 100 comments, the latest ones as many as the
// item's read keeps (1 point; 2 for the first of a pull request, which also reads its latest 100 reviews); read when
// the conversation shows, not in the background.
import { PluginError } from "@gasho/plugin-sdk/daemon";
import { gh, itemRead, type Ctx } from "../core.ts";
import { COMMENTS_MAX } from "../detail/comments.ts";
import { kindArg, login, num, numberArg, repoArg, str } from "../gh.ts";
import type { Op } from "../op.ts";

/** GitHub's reactions, in the order GitHub shows them. */
export const REACTIONS = ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"] as const;
export type ReactionContent = (typeof REACTIONS)[number];

/** Who gave a reaction is read for this many of them, as GitHub's tooltip names them; it costs no more points. */
export const REACTORS_NAMED = 10;

/** A reaction someone gave: how many gave it, the first of them, and whether gh's login is one of them. */
export interface Reaction {
  content: ReactionContent;
  count: number;
  /** Logins, at most REACTORS_NAMED. */
  users: string[];
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

export interface ReviewMeta {
  /** As GitHubReview's id. */
  id: string;
  reactions: Reaction[];
}

export interface ConversationMeta {
  /** The issue's or pull request's node id: what the body's reactions are given to. */
  id: string;
  /** The body's reactions. */
  reactions: Reaction[];
  /** Oldest first. */
  comments: CommentMeta[];
  /** A pull request's latest reviews; none for an issue. */
  reviews: ReviewMeta[];
}

/** A node id of GraphQL, as this read gives them (IC_kwDO…, or the older base64 ones). */
export function nodeIdArg(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_+/=-]{4,200}$/.test(v)) throw new PluginError("コメントなどの指定が正しくありません。");
  return v;
}

const PAGE = 100;
// Reactors are bots, users, organizations and mannequins: all of them actors with a login.
const GROUPS = `reactionGroups { content viewerHasReacted reactors(first: ${REACTORS_NAMED}) { totalCount nodes { ... on Actor { login } } } }`;
const COMMENT = `id url author { __typename } viewerDidAuthor viewerCanUpdate viewerCanDelete ${GROUPS}`;
const SUBJECT = `id ${GROUPS} comments(last: ${PAGE}, before: $before) { pageInfo { hasPreviousPage startCursor } nodes { ${COMMENT} } }`;
// GitHub counts the points of a query before it runs, so the reviews cost a point even of an issue unless left out.
const REVIEWS = `reviews(last: ${PAGE}) @include(if: $reviews) { nodes { id ${GROUPS} } }`;

/** A page of the latest comments, before `before` (a cursor of the page after it), with the reviews when `reviews`. */
export function commentsQueryArgs(repo: string, number: number, before?: string, reviews = false): string[] {
  const [owner, name] = repo.split("/") as [string, string];
  const query =
    "query($owner: String!, $name: String!, $number: Int!, $before: String, $reviews: Boolean!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { " +
    `... on Issue { ${SUBJECT} } ... on PullRequest { ${SUBJECT} ${REVIEWS} } } } }`;
  const vars = ["-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`, "-F", `reviews=${reviews}`, ...(before ? ["-f", `before=${before}`] : [])];
  return ["api", "graphql", "-f", `query=${query}`, ...vars];
}

const CONTENTS = new Set<string>(REACTIONS);

/** Only the reactions someone gave, in GitHub's order. */
function reactionsOf(groups: unknown): Reaction[] {
  const given = (Array.isArray(groups) ? groups : []).flatMap((g): Reaction[] => {
    const r = (g ?? {}) as Record<string, unknown>;
    const content = str(r.content);
    const reactors = (r.reactors ?? {}) as { totalCount?: unknown; nodes?: unknown[] };
    const count = num(reactors.totalCount) ?? 0;
    const users = (Array.isArray(reactors.nodes) ? reactors.nodes : []).flatMap((n) => login(n) ?? []);
    return content && CONTENTS.has(content) && count > 0 ? [{ content: content as ReactionContent, count, users, mine: r.viewerHasReacted === true }] : [];
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
  const reviews = (((subject.reviews ?? {}) as { nodes?: unknown[] }).nodes ?? []).flatMap((raw): ReviewMeta[] => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const rid = str(r.id);
    return rid ? [{ id: rid, reactions: reactionsOf(r.reactionGroups) }] : [];
  });
  const before = page.pageInfo?.hasPreviousPage === true ? str(page.pageInfo.startCursor) : undefined;
  return { meta: { id, reactions: reactionsOf(subject.reactionGroups), comments, reviews }, ...(before ? { before } : {}) };
}

/** `reviews`: it is a pull request, whose latest reviews the first page reads. */
export async function readComments(ctx: Ctx, repo: string, number: number, params: Record<string, unknown>, reviews = false): Promise<ConversationMeta> {
  const read = itemRead(ctx, repo, number, params);
  let meta: ConversationMeta | undefined;
  let before: string | undefined;
  do {
    const { stdout } = await read(commentsQueryArgs(repo, number, before, reviews && !meta));
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
    const pull = p.kind !== undefined && kindArg(p.kind) === "pulls";
    return gh(`read the comments of #${number}`, () => readComments(ctx, repo, number, p, pull), ctx);
  },
} satisfies Op;
