// What both parts of github-implement share about an edit's `was` (ops/edit.ts): for the body, the screen sends a hash of
// the body its edit started from rather than the body, as the Gasho server takes at most 64 KB of JSON as a call's
// params and the new body is in them too. The daemon part hashes GitHub's body the same way. Not crypto.subtle: a Gasho
// opened over http does not have it.

/** Two 32-bit lanes mixed as cyrb53 does, with the length: not for secrets, only to tell two texts apart. */
export function textHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${text.length}:${hex(h2)}${hex(h1)}`;
}

export const TEXT_HASH = /^\d{1,7}:[0-9a-f]{16}$/;

/** The params of the screen's edit of the body: `from` is GitHub's body the new one is saved over. */
export function bodyEditParams(body: string, from: string): { body: string; was: { bodyHash: string } } {
  return { body, was: { bodyHash: textHash(from) } };
}
