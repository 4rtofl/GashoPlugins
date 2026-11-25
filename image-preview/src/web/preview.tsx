// The view of an image in a session's file panel (a file viewer of Gasho's plugin API 1.18): the image in a box where
// the wheel and a pinch zoom it and a drag moves it, the arrows to the other images of its folder, and its size.
import { ChevronLeft, ChevronRight, Maximize } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn, PANEL_BUTTON, type FileContent, type FileViewerProps } from "@gasho/plugin-sdk";
import { folderImages, formatBytes } from "./images";
import { fitView, moveView, wheelFactor, type Point, type Size, type View } from "./zoom";

/** From this magnification on, the image's pixels show as squares, not smoothed into one another, to be told apart. */
const PIXELATED = 3;

const BOX = "relative h-[70vh] overflow-hidden rounded-xl border border-border bg-[image:repeating-conic-gradient(#ffffff0d_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]";

export function ImagePreview({ path, file, entries, openFile }: FileViewerProps) {
  const root = useRef<HTMLDivElement>(null);
  const { paths, index } = folderImages(path, entries);
  const prev = index > 0 ? paths[index - 1] : undefined;
  const next = index >= 0 ? paths[index + 1] : undefined;
  const name = path.slice(path.lastIndexOf("/") + 1);

  // Gasho draws the viewer anew for each file it opens, and the focus it had goes with it. It comes here when nothing
  // else has it (not the input of the session, for one), so that ← → go on to the next image.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) root.current?.focus({ preventScroll: true });
  }, []);

  const go = (to: string | undefined) => {
    if (!to) return;
    root.current?.focus({ preventScroll: true });
    openFile(to);
  };

  const nav =
    index >= 0 && paths.length > 1 ? (
      <>
        <NavButton side="left" label="前の画像" disabled={!prev} onClick={() => go(prev)} />
        <NavButton side="right" label="次の画像" disabled={!next} onClick={() => go(next)} />
      </>
    ) : null;
  const position = nav ? `${index + 1} / ${paths.length}` : undefined;

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="group"
      aria-label={`${name} のプレビュー`}
      aria-keyshortcuts={nav ? "ArrowLeft ArrowRight" : undefined}
      onKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const to = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : undefined;
        if (!to) return;
        e.preventDefault();
        go(to);
      }}
      className="space-y-2 outline-none"
    >
      {file.image ? (
        <Stage key={path} file={file} image={file.image} name={name} nav={nav} position={position} />
      ) : (
        <>
          <div className="relative">
            <div className={cn(BOX, "grid place-items-center px-14 py-6")}>
              <p className="text-center text-sm text-muted-foreground">
                {file.tooLarge
                  ? `大きすぎるので表示しません（${formatBytes(file.size)}）。表示できる画像は 5MB までです。`
                  : "画像として読めなかったので、表示しません。"}
              </p>
            </div>
            {nav}
          </div>
          <Info file={file} position={position} />
        </>
      )}
    </div>
  );
}

function NavButton({ side, label, disabled, onClick }: { side: "left" | "right"; label: string; disabled: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label}（${side === "left" ? "←" : "→"}）`}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-surface-raised disabled:pointer-events-none disabled:opacity-30",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

function Info({ file, natural, position, children }: { file: FileContent; natural?: Size; position?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
      {natural && <span className="tabular-nums">{`${natural.width} × ${natural.height} px`}</span>}
      <span className="tabular-nums">{formatBytes(file.size)}</span>
      {position && <span className="tabular-nums">{position}</span>}
      {children}
    </div>
  );
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** One image: drawn anew for each, so that the next one is shown whole again. */
function Stage({ file, image, name, nav, position }: { file: FileContent; image: { mime: string; data: string }; name: string; nav: ReactNode; position?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>();
  const [natural, setNatural] = useState<Size>();
  const [view, setView] = useState<View>();
  const [broken, setBroken] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The whole image is shown until it is zoomed or moved; till then, it is fitted again when the box changes its size.
  const fitted = useRef(true);
  const pointers = useRef(new Map<number, Point>());
  const sizes = useRef<{ stage?: Size; natural?: Size }>({});
  sizes.current = { stage, natural };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setStage((s) => (s?.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ready = stage !== undefined && natural !== undefined && stage.width > 0 && stage.height > 0 && natural.width > 0 && natural.height > 0;
  useEffect(() => {
    if (!ready) return;
    setView((v) => (fitted.current || !v ? fitView(natural, stage) : moveView(v, natural, stage, {})));
  }, [ready, stage?.width, stage?.height, natural?.width, natural?.height]);

  const move = useCallback((how: Parameters<typeof moveView>[3]) => {
    const { stage, natural } = sizes.current;
    if (!stage || !natural) return;
    fitted.current = false;
    setView((v) => v && moveView(v, natural, stage, how));
  }, []);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  // React's own wheel listener is passive, and could not keep the panel from scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      move({ factor: wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), at: local(e) });
    };
    // Safari tells a pinch on a trackpad by gesture events, not by the wheel, and zooms the page unless they are
    // prevented. On a touch screen, the pointers below zoom the image, and Safari's gesture events for it do nothing.
    let last = 1;
    const gestureStart = (e: Event) => {
      e.preventDefault();
      last = 1;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      if (pointers.current.size < 2) move({ factor: g.scale / last, at: local(g) });
      last = g.scale;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", gestureStart);
    el.addEventListener("gesturechange", gestureChange);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", gestureStart);
      el.removeEventListener("gesturechange", gestureChange);
    };
  }, [move]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    setDragging(true);
  };
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const all = pointers.current;
    const before = all.get(e.pointerId);
    if (!before) return;
    const now = local(e);
    all.set(e.pointerId, now);
    const other = [...all].find(([id]) => id !== e.pointerId)?.[1];
    if (!other) {
      move({ by: { x: now.x - before.x, y: now.y - before.y } });
      return;
    }
    // Two fingers: the point between them stays over the same point of the image, and they zoom as they spread.
    const from = middle(before, other);
    const to = middle(now, other);
    const span = distance(before, other);
    move({ factor: span > 0 ? distance(now, other) / span : 1, at: from, by: { x: to.x - from.x, y: to.y - from.y } });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  const fit = () => {
    if (!ready) return;
    fitted.current = true;
    setView(fitView(natural, stage));
  };

  const movable = ready && view !== undefined && (natural.width * view.scale > stage.width + 0.5 || natural.height * view.scale > stage.height + 0.5);

  return (
    <>
      <div className="relative">
        <div
          ref={box}
          onPointerDown={down}
          onPointerMove={drag}
          onPointerUp={up}
          onPointerCancel={up}
          className={cn(BOX, "touch-none select-none", movable && (dragging ? "cursor-grabbing" : "cursor-grab"))}
        >
          {broken ? (
            <p className="grid h-full place-items-center px-14 py-6 text-center text-sm text-muted-foreground">この画像は、ブラウザーで表示できません。</p>
          ) : (
            <img
              alt={name}
              src={`data:${image.mime};base64,${image.data}`}
              draggable={false}
              onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              onError={() => setBroken(true)}
              style={view ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } : undefined}
              className={cn(
                "absolute top-0 left-0 h-auto max-w-none origin-top-left",
                !view && "invisible",
                view && view.scale >= PIXELATED && "[image-rendering:pixelated]",
              )}
            />
          )}
        </div>
        {nav}
      </div>
      <Info file={file} natural={broken ? undefined : natural} position={position}>
        {view && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="tabular-nums" title="倍率">{`${Math.round(view.scale * 100)}%`}</span>
            <button type="button" onClick={fit} title="画像の全体が収まる大きさに戻す" className={PANEL_BUTTON}>
              <Maximize className="size-3.5" />
              全体を表示
            </button>
          </span>
        )}
      </Info>
    </>
  );
}
