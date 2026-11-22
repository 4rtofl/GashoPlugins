// The references in the text of an issue or pull request that GitHub links: #17 after a space, a bracket or the start
// (not inside a word or a URL, …/#17), another repository's owner/name#17 and owner/name@sha, and a commit's hash of 7
// to 40 characters. A hash needs a digit and a letter, as GitHub links only the hashes of commits it has, and words
// (defaced, acceded) and plain numbers are hex too.

export interface TextRef {
  /** Where it starts and ends in the text. */
  start: number;
  end: number;
  /** Another repository's (owner/name); absent: the item's own. */
  repo?: string;
  number?: number;
  sha?: string;
}

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})";
const NAME = "[A-Za-z0-9._-]{1,100}";
const REF = new RegExp(`(?:(${OWNER})/(${NAME}))?(?:#(\\d{1,9})(?![\\w])|@([0-9a-f]{7,40})(?![\\w-]))|([0-9a-f]{7,40})(?![\\w-])`, "g");

/** Every reference of `text`, in order. */
export function refsIn(text: string): TextRef[] {
  const refs: TextRef[] = [];
  for (const m of text.matchAll(REF)) {
    const start = m.index;
    const [whole, owner, name, number, repoSha, sha] = m;
    if (start > 0 && /[\w/&#@.-]/.test(text[start - 1] ?? "")) continue;
    const at = { start, end: start + whole.length, ...(owner && name ? { repo: `${owner}/${name}` } : {}) };
    if (number !== undefined) {
      if (Number(number) >= 1) refs.push({ ...at, number: Number(number) });
    } else if (repoSha !== undefined) {
      if (owner) refs.push({ ...at, sha: repoSha });
    } else if (sha !== undefined && /\d/.test(sha) && /[a-f]/.test(sha)) {
      refs.push({ ...at, sha });
    }
  }
  return refs;
}

/** The reference that the place `offset` of `text` is in or at the edge of. */
export function refAt(text: string, offset: number): TextRef | undefined {
  return refsIn(text).find((r) => offset >= r.start && offset <= r.end);
}

/** Where GitHub shows it; `repo` is the item's. GitHub opens a pull request's page from its number's issue page. */
export function refUrl(ref: TextRef, repo: string): string {
  const of = ref.repo ?? repo;
  return ref.sha ? `https://github.com/${of}/commit/${ref.sha}` : `https://github.com/${of}/issues/${ref.number}`;
}
