// The images of a folder, which the arrows move between, and how their sizes are written.
import type { DirEntry } from "@gasho/plugin-sdk";

/** The images gasho-daemon sends as pictures. It sends an SVG as text, which Gasho shows and edits. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"];

const IMAGE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join("|")})$`, "i");

/** The images in the folder of `path`, in the order of the file list, and where `path` is among them (-1: not there). */
export function folderImages(path: string, entries: DirEntry[] | undefined): { paths: string[]; index: number } {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1);
  const paths = (entries ?? []).filter((e) => e.kind === "file" && !e.outside && IMAGE.test(e.name)).map((e) => dir + e.name);
  return { paths, index: paths.indexOf(path) };
}

/** As the file panel writes a size above the image: "812 B", "1.3 KB", "245 KB", "4.2 MB". */
export function formatBytes(n: number): string {
  const shown = (x: number): string => (x < 10 ? (Math.ceil(x * 10 - 1e-9) / 10).toFixed(1) : String(Math.round(x)));
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${shown(kb)} KB`;
  return `${shown(kb / 1024)} MB`;
}
