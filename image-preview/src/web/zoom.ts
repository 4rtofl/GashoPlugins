// Where the image lies in the stage (the box it is shown in), and how zooming and dragging move it. In the stage's
// pixels: the image's top left corner (x, y), and how many of them one pixel of the image takes (scale).

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

/** The most an image is magnified: one of its pixels as 32 × 32. */
export const MAX_SCALE = 32;

/** The scale at which the whole image fits in the stage. An image smaller than the stage keeps its own size. */
export function fitScale(image: Size, stage: Size): number {
  return Math.min(1, stage.width / image.width, stage.height / image.height);
}

/** The whole image, in the middle of the stage. */
export function fitView(image: Size, stage: Size): View {
  return place({ scale: fitScale(image, stage), x: 0, y: 0 }, image, stage);
}

/**
 * Zooms by `factor` about `at`, which stays over the same point of the image, then moves by `by`. The image does not get
 * smaller than it fits, nor larger than MAX_SCALE.
 */
export function moveView(view: View, image: Size, stage: Size, { factor = 1, at = { x: 0, y: 0 }, by = { x: 0, y: 0 } }: { factor?: number; at?: Point; by?: Point }): View {
  const scale = Math.min(Math.max(view.scale * factor, fitScale(image, stage)), MAX_SCALE);
  const k = scale / view.scale;
  return place({ scale, x: at.x - (at.x - view.x) * k + by.x, y: at.y - (at.y - view.y) * k + by.y }, image, stage);
}

/** Across the stage, an image narrower than it lies in the middle; a wider one cannot be dragged to leave a gap at an edge. The same up and down. */
function place(view: View, image: Size, stage: Size): View {
  const axis = (pos: number, size: number, room: number) => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, pos)));
  return { scale: view.scale, x: axis(view.x, image.width * view.scale, stage.width), y: axis(view.y, image.height * view.scale, stage.height) };
}

/**
 * How much a wheel event zooms: a notch of a mouse's wheel (about 100 px) by about 13 %. A trackpad's pinch comes as the
 * wheel with ctrlKey, in steps of a few pixels, so it zooms more for each pixel. One event zooms at most twice or half.
 */
export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return 2 ** Math.min(1, Math.max(-1, -px * (pinch ? 0.01 : 0.002)));
}
