import assert from "node:assert/strict";
import { test } from "node:test";
import { transferTargets } from "../src/daemon/ops/transfer-targets.ts";

const repo = (nameWithOwner: string, more: Record<string, unknown> = {}) => ({ nameWithOwner, hasIssuesEnabled: true, isArchived: false, viewerPermission: "WRITE", visibility: "PUBLIC", ...more });

test("an issue moves only to the owner's other repositories that have issues and that the login can write to", () => {
  const json = JSON.stringify([
    repo("4rtoflow/GashoPlugins"),
    repo("4rtoflow/Gasho", { viewerPermission: "ADMIN" }),
    repo("4rtoflow/Archived", { isArchived: true }),
    repo("4rtoflow/NoIssues", { hasIssuesEnabled: false }),
    repo("4rtoflow/ReadOnly", { viewerPermission: "READ" }),
    repo("4rtoflow/Triage", { viewerPermission: "TRIAGE" }),
    repo("4rtoflow/Audipp", { viewerPermission: "MAINTAIN", visibility: "PRIVATE" }),
  ]);
  assert.deepEqual(transferTargets(json, "4rtoflow/gashoplugins"), ["4rtoflow/Audipp", "4rtoflow/Gasho"]);
});

test("from a repository that is not public, an issue never moves into a public one", () => {
  const json = JSON.stringify([repo("4rtoflow/Secret", { visibility: "PRIVATE" }), repo("4rtoflow/Open"), repo("4rtoflow/Inside", { visibility: "INTERNAL" }), repo("4rtoflow/Other", { visibility: "PRIVATE" })]);
  assert.deepEqual(transferTargets(json, "4rtoflow/Secret"), ["4rtoflow/Inside", "4rtoflow/Other"]);
});
