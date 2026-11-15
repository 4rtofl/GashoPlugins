// The comments of an issue or pull request, oldest first; when there are many, the latest ones.
import type { GitHubComment } from "../../types.ts";
import { clip, httpsUrl, login, str, type DetailPart } from "../gh.ts";

export const COMMENTS_MAX = 200;

export default {
  fields: { issues: ["comments"], pulls: ["comments"] },
  read(raw, item) {
    const comments = (Array.isArray(raw.comments) ? raw.comments : []).flatMap((c): GitHubComment[] => {
      const createdAt = str(c?.createdAt);
      if (!createdAt) return [];
      const minimized = c?.isMinimized === true;
      const author = login(c?.author);
      const url = httpsUrl(c?.url);
      return [{ ...(author ? { author } : {}), createdAt, body: minimized ? "" : clip(str(c?.body) ?? ""), ...(url ? { url } : {}), ...(minimized ? { minimized: true } : {}) }];
    });
    item.comments = comments.slice(-COMMENTS_MAX);
    if (comments.length > COMMENTS_MAX) item.commentsLeftOut = comments.length - COMMENTS_MAX;
  },
} satisfies DetailPart;
