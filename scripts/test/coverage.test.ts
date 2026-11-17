import assert from "node:assert/strict";
import { test } from "node:test";
import { byFolder } from "../coverage.ts";

test("a .ts file no test loads counts its lines of code as not run, and a file of only types does not count", () => {
  const lcov = ["TN:", "SF:git/src/gh.ts", "FNF:2", "FNH:1", "BRF:4", "BRH:3", "LH:8", "LF:10", "end_of_record", ""].join("\n");
  const files: Record<string, string> = {
    "git/src/gh.ts": "",
    "git/src/daemon/index.ts": [
      'import { gh } from "../gh.ts";',
      "",
      "// Why it asks gh.",
      "export interface Request {",
      "  repo: string;",
      "}",
      "/**",
      " * Its issues.",
      " */",
      "export function issues(r: Request): string {",
      "  return gh(r.repo);",
      "}",
      "",
    ].join("\n"),
    "git/src/types.ts": "export interface Issue {\n  number: number;\n}\nexport type Issues = Issue[];\n",
  };
  assert.deepEqual(
    byFolder(lcov, Object.keys(files), (f) => files[f]!).get("git"),
    {
      lines: { hit: 8, found: 10 + 4 },
      branches: { hit: 3, found: 4 },
      functions: { hit: 1, found: 2 },
      unloaded: [{ file: "git/src/daemon/index.ts", lines: 4 }],
    },
  );
});
