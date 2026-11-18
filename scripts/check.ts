// Checks every plugin's gasho-plugin.json (checkPlugins in release.ts): by the rules of the Gasho server (manifest.ts),
// it names a genre of genres.json, its id is the name of its folder, and its folder is a workspace; a plugin with sources
// has a typecheck script. GitHub Actions runs it on every pull request and push to main, before installing anything
// (.github/workflows/release.yml), so that no plugin is added or changed that a Gasho server would refuse, or without a
// genre: Gasho's plugins screen lists the plugins by genre. In GitHub Actions, each problem is an error on its file (an
// annotation). Run it by hand with `npm run check`.
import path from "node:path";
import { annotation, checkPlugins, type Problem } from "./release.ts";

export function report(problems: Problem[], annotate: boolean): string[] {
  return problems.map((p) => (annotate ? annotation("error", p) : `${p.file}: ${p.message}`));
}

if (import.meta.main) {
  const { plugins, problems } = checkPlugins(path.resolve(import.meta.dirname, ".."));
  if (problems.length > 0) {
    for (const line of report(problems, process.env.GITHUB_ACTIONS === "true")) console.error(line);
    console.error(`${problems.length} problem(s). Each plugin's gasho-plugin.json is as a Gasho server takes it, and names its genre ("genre"), one of genres.json.`);
    process.exit(1);
  }
  console.log(`checked ${plugins.length} plugins: ${plugins.map((p) => `${p.manifest.id} (${p.manifest.genre})`).join(", ")}`);
}
