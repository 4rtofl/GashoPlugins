import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DirEntry } from "@gasho/plugin-sdk";
import { folderImages } from "../src/web/images.ts";
import { fitView, MAX_SCALE, moveView, wheelFactor } from "../src/web/zoom.ts";

const file = (name: string, more: Partial<DirEntry> = {}): DirEntry => ({ name, kind: "file", size: 1, ...more });

describe("folderImages", () => {
  const entries = [
    { name: "icons", kind: "dir" } as DirEntry,
    file("a.png"),
    file("b.PNG"),
    file("logo.svg"),
    file("notes.md"),
    file("c.jpeg"),
    file("away.png", { outside: true }),
  ];

  test("the images of the folder, in the order of the file list, under the folder's path", () => {
    assert.deepEqual(folderImages("docs/b.PNG", entries), { paths: ["docs/a.png", "docs/b.PNG", "docs/c.jpeg"], index: 1 });
    assert.deepEqual(folderImages("a.png", entries), { paths: ["a.png", "b.PNG", "c.jpeg"], index: 0 });
  });

  test("no place for a file the list does not have, or before the list is read", () => {
    assert.equal(folderImages("docs/new.png", entries).index, -1);
    assert.deepEqual(folderImages("docs/a.png", undefined), { paths: [], index: -1 });
  });
});

describe("moveView", () => {
  const image = { width: 400, height: 200 };
  const stage = { width: 200, height: 200 };

  test("the whole image fits, in the middle; a small one keeps its size", () => {
    assert.deepEqual(fitView(image, stage), { scale: 0.5, x: 0, y: 50 });
    assert.deepEqual(fitView({ width: 20, height: 10 }, stage), { scale: 1, x: 90, y: 95 });
  });

  test("the point zoomed about stays over the same point of the image", () => {
    const at = { x: 150, y: 100 };
    const before = fitView(image, stage);
    const after = moveView(before, image, stage, { factor: 4, at });
    const imageX = (v: { scale: number; x: number }) => (at.x - v.x) / v.scale;
    assert.equal(after.scale, 2);
    assert.equal(imageX(after), imageX(before));
  });

  test("it gets no smaller than it fits, nor larger than the most", () => {
    const fit = fitView(image, stage);
    assert.deepEqual(moveView(fit, image, stage, { factor: 0.1, at: { x: 10, y: 10 } }), fit);
    assert.equal(moveView(fit, image, stage, { factor: 1000 }).scale, MAX_SCALE);
  });

  test("a drag leaves no gap at an edge, and an image lower than the stage stays in the middle", () => {
    const fit = fitView(image, stage);
    assert.deepEqual(moveView(fit, image, stage, { by: { x: 50, y: 30 } }), fit);
    const zoomed = { scale: 1, x: -100, y: 0 };
    assert.deepEqual(moveView(zoomed, image, stage, { by: { x: 500, y: 0 } }), { scale: 1, x: 0, y: 0 });
    assert.deepEqual(moveView(zoomed, image, stage, { by: { x: -500, y: 0 } }), { scale: 1, x: -200, y: 0 });
  });
});

test("wheelFactor: up zooms in, down zooms out, by at most twice in one event", () => {
  assert.ok(wheelFactor(-100, 0, false) > 1);
  assert.ok(wheelFactor(100, 0, false) < 1);
  assert.ok(wheelFactor(-5, 0, true) > wheelFactor(-5, 0, false));
  assert.equal(wheelFactor(-10_000, 0, false), 2);
  assert.equal(wheelFactor(3, 1, false), wheelFactor(48, 0, false));
});
