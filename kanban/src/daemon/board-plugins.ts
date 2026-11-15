// What the kanban writes in the board plugins' folder of the working server (src/daemon/folder.ts): kanban/plugins/ of
// the checkout that was built, taken into daemon.js by Vite. Not in folder.ts, which the tests run without Vite.
const files = import.meta.glob<string>(["../../plugins/*", "../../plugins/example/*"], { query: "?raw", import: "default", eager: true });

const inFolder = (file: string): string => file.slice("../../plugins/".length);

/** Written again whenever the kanban starts: the types, the helpers, the guide and what tsc and npm need. */
export const PLACED: Record<string, string> = Object.fromEntries(
  Object.entries(files)
    .map(([file, text]): [string, string] => [inFolder(file), text])
    .filter(([file]) => !file.includes("/")),
);

/** Written only when the folder has no example/: each person may change it. */
export const SAMPLE: Record<string, string> = Object.fromEntries(
  Object.entries(files)
    .map(([file, text]): [string, string] => [inFolder(file), text])
    .filter(([file]) => file.startsWith("example/")),
);
