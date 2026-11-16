import assert from "node:assert/strict";
import { test } from "node:test";
import { transferTargets } from "../src/daemon/ops/transfer-targets.ts";

const repo = (nameWithOwner: string, more: Record<string, unknown> = {}) => ({ nameWithOwner, hasIssuesEnabled: true, isArchived: false, viewerPermission: "WRITE", visibility: "PUBLIC", ...more });

test("an issue moves only to the owner's other repositories that have issues and that the login can write to", () => {
  const json = JSON.stringify([
    repo("4rtofl/GashoPlugins"),
    repo("4rtofl/Gasho", { viewerPermission: "ADMIN" }),
    repo("4rtofl/Archived", { isArchived: true }),
    repo("4rtofl/NoIssues", { hasIssuesEnabled: false }),
    repo("4rtofl/ReadOnly", { viewerPermission: "READ" }),
    repo("4rtofl/Triage", { viewerPermission: "TRIAGE" }),
    repo("4rtofl/Audipp", { viewerPermission: "MAINTAIN", visibility: "PRIVATE" }),
  ]);
  assert.deepEqual(transferTargets(json, "4rtofl/gashoplugins"), ["4rtofl/Audipp", "4rtofl/Gasho"]);
});

test("from a repository that is not public, an issue never moves into a public one", () => {
  const json = JSON.stringify([repo("4rtofl/Secret", { visibility: "PRIVATE" }), repo("4rtofl/Open"), repo("4rtofl/Inside", { visibility: "INTERNAL" }), repo("4rtofl/Other", { visibility: "PRIVATE" })]);
  assert.deepEqual(transferTargets(json, "4rtofl/Secret"), ["4rtofl/Inside", "4rtofl/Other"]);
});
