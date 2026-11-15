// Checks every plugin's gasho-plugin.json (checkPlugins in release.ts): it names a genre of genres.json, its id is the
// name of its folder, its version is like 1.2.0, and its folder is a workspace. GitHub Actions runs it on every pull
// request and push to main, before installing anything (.github/workflows/release.yml), so that no plugin is added or
// changed without a genre: Gasho's plugins screen lists the plugins by genre. In GitHub Actions, each problem is an
// error on its file (an annotation). Run it by hand with `npm run check`.
import path from "node:path";
import { checkPlugins, type Problem } from "./release.ts";

/** A workflow command's message, escaped (GitHub Actions' ::error). */
const escape = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export function report(problems: Problem[], annotate: boolean): string[] {
  return problems.map((p) => (annotate ? `::error file=${escape(p.file).replace(/:/g, "%3A").replace(/,/g, "%2C")},title=gasho-plugin.json::${escape(p.message)}` : `${p.file}: ${p.message}`));
}

if (import.meta.main) {
  const { plugins, problems } = checkPlugins(path.resolve(import.meta.dirname, ".."));
  if (problems.length > 0) {
    for (const line of report(problems, process.env.GITHUB_ACTIONS === "true")) console.error(line);
    console.error(`${problems.length} problem(s). Each plugin names its genre in gasho-plugin.json ("genre"), one of genres.json.`);
    process.exit(1);
  }
  console.log(`checked ${plugins.length} plugins: ${plugins.map((p) => `${p.manifest.id} (${p.manifest.genre})`).join(", ")}`);
}
