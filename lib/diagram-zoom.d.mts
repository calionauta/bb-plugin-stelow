export declare const ZOOM_MIN: number;
export declare const ZOOM_MAX: number;
export declare const ZOOM_STEP: number;
export declare const ZOOMED_SCALE: number;
export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}
export interface ZoomPoint {
  px: number;
  py: number;
}
export declare function clampScale(value: unknown): number;
export declare function pointerInCanvas(
  rect: { left: number; top: number },
  scroll: { left: number; top: number },
  origin: { left: number; top: number },
  clientX: number,
  clientY: number,
): ZoomPoint;
export declare function zoomAtPoint(view: ZoomView, factor: number, point: ZoomPoint): ZoomView;
export declare function isZoomed(view: unknown): boolean;
