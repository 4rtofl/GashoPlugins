import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry, FileContent } from "@gasho/plugin-sdk";
import { machine, session } from "../../test/sdk.tsx";
import { ImagePreview } from "../src/web/preview.tsx";

const entries: DirEntry[] = [
  { name: "a.png", kind: "file", size: 10 },
  { name: "notes.md", kind: "file", size: 10 },
  { name: "b.webp", kind: "file", size: 10 },
  { name: "c.gif", kind: "file", size: 10 },
];

const image = (path: string, more: Partial<FileContent> = {}): FileContent => ({
  path,
  size: 250_000,
  mtime: 0,
  writable: true,
  image: { mime: "image/png", data: "AAAA" },
  ...more,
});

function show(path: string, file = image(path)) {
  const openFile = vi.fn();
  render(<ImagePreview machine={machine()} session={session()} path={path} file={file} entries={entries} openFile={openFile} />);
  return openFile;
}

/** The image as the browser loads it: happy-dom neither lays out the box nor decodes the image. */
function load(width: number, height: number) {
  const img = screen.getByRole("img");
  Object.defineProperties(img, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  fireEvent.load(img);
}

describe("ImagePreview", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("goes to the images before and after it in the folder, with ← → and the buttons", async () => {
    const openFile = show("shots/b.webp");
    const preview = screen.getByRole("group");
    expect(document.activeElement).toBe(preview);
    await userEvent.keyboard("{ArrowRight}");
    expect(openFile).toHaveBeenLastCalledWith("shots/c.gif");
    await userEvent.keyboard("{ArrowLeft}");
    expect(openFile).toHaveBeenLastCalledWith("shots/a.png");
    await userEvent.click(screen.getByRole("button", { name: "次の画像" }));
    expect(openFile).toHaveBeenLastCalledWith("shots/c.gif");
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("goes nowhere past the first image", async () => {
    const openFile = show("a.png");
    expect((screen.getByRole("button", { name: "前の画像" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{ArrowLeft}");
    expect(openFile).not.toHaveBeenCalled();
  });

  it("writes the image's width and height and its size under it", () => {
    show("a.png");
    load(1920, 1080);
    expect(screen.getByText("1920 × 1080 px")).toBeTruthy();
    expect(screen.getByText("244 KB")).toBeTruthy();
  });

  it("zooms with the wheel, and shows the whole image again with 全体を表示", async () => {
    show("a.png");
    load(800, 600);
    expect(screen.getByText("50%")).toBeTruthy();
    const box = screen.getByRole("img").parentElement!;
    const wheel = new WheelEvent("wheel", { deltaY: -500, cancelable: true });
    box.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(await screen.findByText("100%")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "全体を表示" }));
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("fits the image again when the box narrows, after a wheel that could not zoom it out", () => {
    let width = 400;
    let resized = () => {};
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resized = cb; } observe() {} disconnect() {} });
    show("a.png");
    load(800, 600);
    screen.getByRole("img").parentElement!.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
    width = 200;
    act(() => resized());
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("tells why a large image is not shown, and still goes on to the next", async () => {
    const openFile = show("a.png", image("a.png", { image: undefined, tooLarge: true, size: 8 * 1024 * 1024 }));
    expect(screen.getByText(/大きすぎるので表示しません（8\.0 MB）/)).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    expect(openFile).toHaveBeenLastCalledWith("b.webp");
  });
});
