// The files a pull request changes.
import type { GitHubFile } from "../../types.ts";
import { num, str, type DetailPart } from "../gh.ts";

const FILES_MAX = 300;

export default {
  fields: { pulls: ["files"] },
  read(raw, item) {
    const files = (Array.isArray(raw.files) ? raw.files : []).flatMap((f): GitHubFile[] => {
      const path = str(f?.path);
      return path ? [{ path, additions: num(f?.additions) ?? 0, deletions: num(f?.deletions) ?? 0 }] : [];
    });
    item.files = files.slice(0, FILES_MAX);
  },
} satisfies DetailPart;
