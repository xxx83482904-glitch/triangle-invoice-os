// Zoom math for the in-app document viewer, kept pure so it can be tested without a browser.
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 6;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6] as const;

export function clampZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 1000) / 1000));
}

// The next preset step from any current zoom, so buttons land on familiar values after a pinch or a fit.
export function nextZoomStep(current: number, direction: 1 | -1) {
  const epsilon = 0.001;
  const step = direction > 0 ? ZOOM_STEPS.find((value) => value > current + epsilon) : ZOOM_STEPS.toReversed().find((value) => value < current - epsilon);
  return step ?? (direction > 0 ? ZOOM_MAX : ZOOM_MIN);
}

// "width" fits the widest page to the frame; "page" also fits the first page's height, so a whole page is visible.
export function fitScale(fit: "width" | "page", pages: Array<{ width: number; height: number }>, frame: { width: number; height: number }) {
  if (!pages.length || frame.width <= 0) return 1;
  const width = frame.width / Math.max(...pages.map((page) => page.width));
  if (fit === "width" || frame.height <= 0) return clampZoom(width);
  return clampZoom(Math.min(width, frame.height / pages[0].height));
}
