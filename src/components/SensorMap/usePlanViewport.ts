import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { clampCentre, centreOn, fitView, panBy, planToScreen, zoomAt, type Px, type Size, type View } from '../../sensorMap/geometry';
import {
  idleMachine,
  step,
  type GestureContext,
  type GestureEvent,
  type GestureMachine,
  type Hit,
  type HitKind,
  type PointerInput,
} from '../../sensorMap/gestures';
import type { Plan } from '../../sensorMap/mapDoc';

const WHEEL_STEP = 0.0016;
const WHEEL_STEP_LINES = 0.05;
const HIT_KINDS: readonly string[] = ['marker', 'handle', 'zone', 'ghost', 'fingerprint', 'survey', 'vent', 'furniture'];

export interface PlanViewportOptions {
  plan: Pick<Plan, 'fit' | 'bounds'>;
  /** Whether a press that starts on this hit drags it instead of panning the plan. */
  draggable: (hit: Hit) => boolean;
  /** Adjusts what a press landed on, for example to the marker nearest the finger. */
  refineHit?: (hit: Hit, px: Px, view: View, size: Size) => Hit;
  /** Every gesture event except the view changes the hook applies itself. */
  onEvent: (event: GestureEvent) => void;
  /** A view saved by an earlier visit; the plan is fitted instead when there is none. */
  initialView?: View | null;
}

export interface PlanViewport {
  view: View | null;
  size: Size;
  containerRef: RefObject<HTMLDivElement | null>;
  svgRef: RefObject<SVGSVGElement | null>;
  pointerHandlers: {
    onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<SVGSVGElement>) => void;
  };
  zoomBy: (factor: number) => void;
  fit: () => void;
  centreOn: (x: number, y: number, minScale?: number, lift?: number) => void;
  panByMetres: (dx: number, dy: number) => void;
  /** Pans, if need be, so a plan point shows above a sheet that covers the bottom `coveredFraction` of the canvas. */
  reveal: (x: number, y: number, coveredFraction: number) => void;
  /** Ends any gesture in progress, as a page hide does; a drag in progress is cancelled. */
  cancelGestures: () => void;
}

export function hitOf(target: EventTarget | null): Hit {
  const element = target instanceof Element ? target.closest('[data-hit]') : null;
  const kind = element?.getAttribute('data-hit') ?? '';
  if (!element || !HIT_KINDS.includes(kind)) return { kind: 'plan', id: null };
  return { kind: kind as HitKind, id: element.getAttribute('data-id') };
}

/** The viewport of the plan: its size, the view onto it, and the pointer, wheel and button controls that move it.
 * Pointer events go through the pure state machine in `sensorMap/gestures`. */
export function usePlanViewport(options: PlanViewportOptions): PlanViewport {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef<Size>(size);
  const touchedRef = useRef(options.initialView != null);
  const machineRef = useRef<GestureMachine>(idleMachine());
  const frameRef = useRef<number | null>(null);
  const optionsRef = useRef(options);

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const commit = useCallback((next: View, immediate = false) => {
    viewRef.current = next;
    if (immediate) {
      setView(next);
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setView(viewRef.current);
    });
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const box = container.getBoundingClientRect();
      const next = { w: Math.max(box.width, 1), h: Math.max(box.height, 1) };
      sizeRef.current = next;
      setSize(next);
      const { fit, bounds } = optionsRef.current.plan;
      const current = viewRef.current;
      if (current === null) {
        const initial = optionsRef.current.initialView;
        commit(initial ? clampCentre(initial, bounds) : fitView(next, fit), true);
      } else if (!touchedRef.current) {
        commit(fitView(next, fit), true);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [commit]);

  const dispatch = useCallback(
    (input: PointerInput) => {
      const current = viewRef.current;
      if (!current) return;
      const { plan: shape, draggable, onEvent } = optionsRef.current;
      const context: GestureContext = { view: current, size: sizeRef.current, fit: shape.fit, bounds: shape.bounds, draggable };
      const result = step(machineRef.current, input, context);
      machineRef.current = result.machine;
      svgRef.current?.setAttribute('data-gesture', result.machine.state.mode);
      for (const event of result.events) {
        if (event.type === 'view') {
          touchedRef.current = true;
          commit(event.view);
        } else if (event.type === 'double-tap') {
          touchedRef.current = true;
          commit(zoomAt(viewRef.current ?? current, sizeRef.current, shape.fit, shape.bounds, 2, event.px.x, event.px.y));
        } else {
          onEvent(event);
        }
      }
    },
    [commit]
  );

  const local = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const pointerHandlers: PlanViewport['pointerHandlers'] = {
    onPointerDown: event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured.
      }
      const px = local(event);
      const hit = hitOf(event.target);
      const current = viewRef.current;
      const refined = current ? (optionsRef.current.refineHit?.(hit, px, current, sizeRef.current) ?? hit) : hit;
      dispatch({ type: 'down', id: event.pointerId, px, hit: refined, time: event.timeStamp });
    },
    onPointerMove: event => dispatch({ type: 'move', id: event.pointerId, px: local(event) }),
    onPointerUp: event => dispatch({ type: 'up', id: event.pointerId, px: local(event), time: event.timeStamp }),
    onPointerCancel: event => dispatch({ type: 'cancel', id: event.pointerId }),
    onLostPointerCapture: event => dispatch({ type: 'cancel', id: event.pointerId }),
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewRef.current;
      if (!current) return;
      const box = svg.getBoundingClientRect();
      const { fit, bounds } = optionsRef.current.plan;
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? WHEEL_STEP_LINES : WHEEL_STEP));
      touchedRef.current = true;
      commit(zoomAt(current, sizeRef.current, fit, bounds, factor, event.clientX - box.left, event.clientY - box.top));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [commit]);

  const cancelGestures = useCallback(() => dispatch({ type: 'reset' }), [dispatch]);

  useEffect(() => {
    const onHide = () => dispatch({ type: 'reset' });
    const onVisibility = () => {
      if (document.hidden) onHide();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dispatch]);

  const zoomBy = useCallback(
    (factor: number) => {
      const current = viewRef.current;
      if (!current) return;
      const { fit, bounds } = optionsRef.current.plan;
      const { w, h } = sizeRef.current;
      touchedRef.current = true;
      commit(zoomAt(current, sizeRef.current, fit, bounds, factor, w / 2, h / 2));
    },
    [commit]
  );

  const fit = useCallback(() => {
    touchedRef.current = false;
    commit(fitView(sizeRef.current, optionsRef.current.plan.fit));
  }, [commit]);

  const centre = useCallback(
    (x: number, y: number, minScale = 0, lift = 0) => {
      const current = viewRef.current;
      if (!current) return;
      const { fit: shape, bounds } = optionsRef.current.plan;
      touchedRef.current = true;
      const next = centreOn(current, sizeRef.current, shape, bounds, x, y, minScale);
      commit(clampCentre({ ...next, cy: next.cy - lift / next.s }, bounds));
    },
    [commit]
  );

  const panByMetres = useCallback(
    (dx: number, dy: number) => {
      const current = viewRef.current;
      if (!current) return;
      touchedRef.current = true;
      commit(clampCentre({ ...current, cx: current.cx + dx, cy: current.cy + dy }, optionsRef.current.plan.bounds));
    },
    [commit]
  );

  const reveal = useCallback(
    (x: number, y: number, coveredFraction: number) => {
      const current = viewRef.current;
      if (!current || coveredFraction <= 0) return;
      const { h } = sizeRef.current;
      const visible = h * (1 - coveredFraction);
      const at = planToScreen(current, sizeRef.current, x, y);
      if (at.y >= 40 && at.y <= visible - 40) return;
      touchedRef.current = true;
      commit(panBy(current, 0, visible / 2 - at.y, optionsRef.current.plan.bounds));
    },
    [commit]
  );

  return { view, size, containerRef, svgRef, pointerHandlers, zoomBy, fit, centreOn: centre, panByMetres, reveal, cancelGestures };
}
