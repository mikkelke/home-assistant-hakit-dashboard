import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { dumpOf, fetchDump } from '../../sensorMap/bermuda';
import { ALL_APS, apChoices, coveragePoints, matchesAp, roomCoverage, type CoveragePoint } from '../../sensorMap/coverage';
import {
  CAPTURE_WINDOW_S,
  CaptureCancelled,
  abortableWait,
  finishCapture,
  runCapture,
  startCapture as beginCapture,
  type CaptureConfig,
} from '../../sensorMap/fingerprint';
import { markerNear, scaleBarLength, snapToWall, wallSnapRadius } from '../../sensorMap/geometry';
import type { GestureEvent, Hit } from '../../sensorMap/gestures';
import {
  FACING_STEP_DEG,
  fingerprintBytes,
  isRadar,
  newDeviceKey,
  noWifi,
  normalizeDeg,
  round2,
  type Facing,
  type Fingerprint,
  type MapDevice,
  type MapOp,
  type NewDevice,
  type Point,
  type SuggestItem,
} from '../../sensorMap/mapDoc';
import { HANDLE_MIN_PX_PER_M, bearingTo, handlePoint } from '../../sensorMap/radarRange';
import { deviceFromCandidate, trayItems } from '../../sensorMap/registry';
import type { SaveQueue } from '../../sensorMap/saveQueue';
import { nextPoint, surveyPoints, surveyProgress, type SurveyPoint } from '../../sensorMap/survey';
import { readWifi, runWifi, sendUpdateCommand } from '../../sensorMap/wifi';
import { useViewer } from '../../hooks/useViewer';
import { hapticTick } from '../../utils/haptics';
import { CaptureSheet, type SurveyTarget } from './CaptureSheet';
import { CoverageBar } from './CoverageBar';
import { HIT_RADIUS_PX } from './DeviceMarker';
import { DeviceSheet } from './DeviceSheet';
import { FingerprintSheet } from './FingerprintSheet';
import { GhostSheet } from './GhostSheet';
import { LayersSheet } from './LayersSheet';
import type { Ghost } from './MarkLayers';
import { ModeControl } from './ModeControl';
import { PhoneLayer } from './PhoneLayer';
import { PhoneSheet } from './PhoneSheet';
import { PlanCanvas, type CoverageView, type SurveyView } from './PlanCanvas';
import { QuestionsSheet } from './QuestionsSheet';
import { SuggestionsSheet } from './SuggestionsSheet';
import { SurveyBar } from './SurveyBar';
import { TraySheet } from './TraySheet';
import { UnplacedTray } from './UnplacedTray';
import { SetupSheet } from './SetupSheet';
import { ZoneSheet } from './ZoneSheet';
import {
  hiddenTypeCount,
  typeVisible,
  type Capture,
  type DeviceActions,
  type DragPreview,
  type Layers,
  type Mode,
  type Selection,
  type Switch,
} from './types';
import { loadUi, saveUi } from './uiStorage';
import { DraftPrompt } from './DraftPrompt';
import { useCandidates } from './useCandidates';
import { useMapData, type SuggestState } from './useMapData';
import { phoneAreas, usePhones } from './usePhones';
import { usePlanViewport } from './usePlanViewport';
import { useScanners } from './useScanners';
import { useWifiStatus } from './useWifi';
import { keepScreenOn } from './keepScreenOn';
import { resultText, setupLabel } from './wifiText';
import './SensorMap.css';

interface SensorMapPageProps {
  onClose: () => void;
}

/** Below this width a sheet is a bottom sheet over the map; from it, a side panel beside the map. */
const SIDE_PANEL_MIN_PX = 900;
const SHEET_COVER = 0.45;

const SAVE_TEXT = { saved: 'saved', pending: 'pending', saving: 'saving', failed: 'failed', conflict: 'changed elsewhere' } as const;
const HANDLE_KEY = '#handle';
const stamp = () => new Date().toISOString();

/** Bed mats lie under the mattress, not on a wall face; everything else defaults to the nearest wall. */
function defaultSnap(device: Pick<MapDevice, 'type'>): boolean {
  return device.type !== 'bed';
}

const isTyping = (target: EventTarget | null) => target instanceof Element && target.closest('input, select, textarea') !== null;

type DragOrigin = { key: string; x: number; y: number; kind: 'move' | 'facing' | 'ghost'; last: DragPreview | null };

const NO_POINTS: readonly SurveyPoint[] = [];
/** The reach of a survey target, as drawn: a press nearer to another target than to the one drawn on top means the nearer. */
const SURVEY_HIT_PX = 22;
const NO_COVERAGE: readonly CoveragePoint[] = [];
const CAPTURE_HIDDEN = 'the screen turned off or the page was hidden, so nothing was kept. Keep the screen on for 10 s.';

/** The `#map` page. It waits for the viewer lookup, closes itself for anyone but an administrator, and loads the
 * documents only for an administrator. */
export function SensorMapPage({ onClose }: SensorMapPageProps) {
  const { isAdmin } = useViewer();

  useEffect(() => {
    if (isAdmin === false) onClose();
  }, [isAdmin, onClose]);

  if (isAdmin !== true) return <div className='sensor-map' data-theme='dark' data-gate={isAdmin === null ? 'loading' : 'denied'} />;
  return <SensorMapLoader onClose={onClose} />;
}

function SensorMapLoader({ onClose }: SensorMapPageProps) {
  const { load, suggest, retry, settleDrafts } = useMapData();
  return (
    <div className='sensor-map' data-theme='dark'>
      {load.status === 'ready' && load.drafts.length === 0 ? (
        <MapWorkspace queue={load.queue} suggest={suggest} onClose={onClose} />
      ) : (
        <>
          <header className='sm-header'>
            <div className='sm-header-row'>
              <button type='button' className='sm-icon-btn' onClick={onClose} aria-label='Close the map'>
                <Icon icon='mdi:chevron-left' />
              </button>
              <h1 className='sm-title'>Sensor map</h1>
            </div>
          </header>
          <div className='sm-status' role={load.status === 'error' ? 'alert' : 'status'}>
            {load.status === 'loading' && <p>Loading the map...</p>}
            {load.status === 'ready' && <DraftPrompt queue={load.queue} drafts={load.drafts} onDone={settleDrafts} />}
            {load.status === 'empty' && (
              <>
                <p>There is no map document in Home Assistant yet.</p>
                <p className='sm-muted'>Load one with the sensor-map CLI (seed), then try again.</p>
                <button type='button' className='sm-chip' onClick={retry}>
                  Try again
                </button>
              </>
            )}
            {load.status === 'error' && (
              <>
                <p>The map could not be loaded.</p>
                <p className='sm-muted'>{load.message}</p>
                <button type='button' className='sm-chip' onClick={retry}>
                  Try again
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface WorkspaceProps {
  queue: SaveQueue;
  suggest: SuggestState;
  onClose: () => void;
}

function MapWorkspace({ queue, suggest, onClose }: WorkspaceProps) {
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const doc = snapshot.docs.map;
  const prints = snapshot.docs.fingerprints;
  const connection = useHass(state => state.connection) as Connection | null;
  const scanners = useScanners();
  const [saved] = useState(loadUi);
  const [layers, setLayers] = useState<Layers>(saved.layers);
  const [edit, setEditState] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [snapOverride, setSnapOverride] = useState<{ key: string; on: boolean } | null>(null);
  const [sheet, setSheet] = useState<
    | { kind: 'questions'; focus: string | null }
    | { kind: 'phone'; address: string }
    | { kind: 'setup' }
    | { kind: 'suggestions' }
    | { kind: 'layers' }
    | null
  >(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const [capture, setCapture] = useState<Capture>({ phase: 'idle' });
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [weakOnly, setWeakOnly] = useState(false);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set(saved.skipped));
  const [apFilter, setApFilter] = useState(ALL_APS);
  const [captureResult, setCaptureResult] = useState<{ text: string; ok: boolean } | null>(null);

  const docRef = useRef(doc);
  const scaleRef = useRef(0);
  const dragOrigin = useRef<DragOrigin | null>(null);
  const captureAbort = useRef<AbortController | null>(null);
  const wifiSkip = useRef<AbortController | null>(null);
  const hiddenAbort = useRef(false);
  const lastPoint = useRef<string | null>(null);
  const heightCm = useRef(100);

  useLayoutEffect(() => {
    docRef.current = doc;
  });

  const apply = useCallback((make: (at: string) => MapOp) => queue.apply({ target: 'map', op: make(stamp()) }), [queue]);

  const selectedKey = selection?.kind === 'device' ? selection.key : null;
  const selectedDevice = selectedKey ? doc.devices[selectedKey] : undefined;
  const snapFor = (key: string, device: MapDevice) => (snapOverride && snapOverride.key === key ? snapOverride.on : defaultSnap(device));

  const phones = usePhones(doc.phones, layers.phones);
  const areas = useMemo(() => phoneAreas(phones.statuses), [phones.statuses]);
  const { candidates, error: candidateError } = useCandidates(doc, scanners, edit);
  const tray = useMemo(() => trayItems(doc.devices, candidates), [doc.devices, candidates]);
  const scannerSources = useMemo(() => (scanners ? new Set(scanners.map(scanner => scanner.source.toUpperCase())) : null), [scanners]);

  const pendingItems = useMemo(() => {
    const decided = new Set(doc.suggest_log.map(entry => entry.id));
    return (suggest.doc?.items ?? []).filter(item => !decided.has(item.id));
  }, [suggest.doc, doc.suggest_log]);
  const answerProposals = pendingItems.filter((item): item is Extract<SuggestItem, { kind: 'answer' }> => item.kind === 'answer');

  const ghosts = useMemo<Ghost[]>(() => {
    const stale = (suggest.doc?.based_on_layout_version ?? doc.layout_version) < doc.layout_version;
    const out: Ghost[] = [];
    for (const item of pendingItems) {
      if (item.kind === 'placement') {
        const device = doc.devices[item.device_key];
        const pos = item.placement.pos;
        const from = device?.placement.pos;
        if (device && pos) out.push({ id: item.id, from: from ? [from.x, from.y] : null, at: [pos.x, pos.y], device, stale });
      } else if (item.kind === 'new_device') {
        const pos = item.device.placement.pos;
        if (pos) out.push({ id: item.id, from: null, at: [pos.x, pos.y], device: item.device, stale });
      } else if (item.kind === 'furniture') {
        const { name, box } = item.furniture;
        const at: Point = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
        out.push({ id: item.id, from: null, at, device: { name, type: 'other' }, box, stale: false });
      }
    }
    return out;
  }, [pendingItems, suggest.doc, doc.devices, doc.layout_version]);

  const setupProposals = pendingItems.filter(
    (item): item is Extract<SuggestItem, { kind: 'wifi' | 'phone' }> => item.kind === 'wifi' || item.kind === 'phone'
  );
  const setup = setupLabel(setupProposals.map(item => item.kind));
  const wifiReady = useWifiStatus(doc.wifi.source);
  const canCapture = doc.phones.length > 0 || doc.wifi.source !== null;

  const surveyPts = useMemo(() => (layers.survey ? surveyPoints(doc.plan) : NO_POINTS), [layers.survey, doc.plan]);
  const progress = useMemo(() => surveyProgress(surveyPts, prints.items, skipped), [surveyPts, prints.items, skipped]);
  const surveyRef = useRef({ points: surveyPts, progress });
  useLayoutEffect(() => {
    surveyRef.current = { points: surveyPts, progress };
  });
  const surveyTargets = useMemo(
    () =>
      surveyPts.map(point => {
        const capture = progress.latest[point.id];
        return { key: point.id, x: capture ? capture.pos.x : point.at[0], y: capture ? capture.pos.y : point.at[1] };
      }),
    [surveyPts, progress]
  );
  const activeSurveyId = capture.phase === 'confirm' || capture.phase === 'running' ? (capture.surveyId ?? null) : null;
  const surveyView = useMemo<SurveyView | null>(
    () => (layers.survey ? { points: surveyPts, progress, activeId: activeSurveyId } : null),
    [layers.survey, surveyPts, progress, activeSurveyId]
  );

  const allCoverage = useMemo(
    () => (layers.coverage ? coveragePoints(prints.items, doc.wifi.aps) : NO_COVERAGE),
    [layers.coverage, prints.items, doc.wifi.aps]
  );
  const apName = useCallback((key: string) => doc.devices[key]?.name, [doc.devices]);
  const apOptions = useMemo(() => apChoices(allCoverage, apName), [allCoverage, apName]);
  const apSelected = apOptions.some(option => option.id === apFilter) ? apFilter : ALL_APS;
  const shownCoverage = useMemo(() => allCoverage.filter(point => matchesAp(point, apSelected)), [allCoverage, apSelected]);
  const roomFills = useMemo(() => roomCoverage(shownCoverage, doc.plan.zones), [shownCoverage, doc.plan.zones]);
  const coverageView = useMemo<CoverageView | null>(
    () => (layers.coverage ? { rooms: roomFills, points: shownCoverage, nameOf: apName } : null),
    [layers.coverage, roomFills, shownCoverage, apName]
  );

  const setEdit = useCallback(
    (on: boolean) => {
      setEditState(on);
      setDrag(null);
      if (!on) setSelection(current => (current?.kind === 'tray' ? null : current));
      void queue.flush();
    },
    [queue]
  );

  const mode: Mode = layers.survey ? 'survey' : edit ? 'edit' : 'view';
  const setMode = (next: Mode) => {
    if (edit !== (next === 'edit')) setEdit(next === 'edit');
    setLayers(current => (current.survey === (next === 'survey') ? current : { ...current, survey: next === 'survey' }));
  };

  const cancelCapture = useCallback(() => {
    captureAbort.current?.abort();
    captureAbort.current = null;
    setCapture({ phase: 'idle' });
  }, []);

  const setSkip = useCallback((id: string, on: boolean) => {
    lastPoint.current = id;
    setSkipped(current => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const retake = useCallback((item: Fingerprint) => {
    setSelection(null);
    if (item.survey_id) lastPoint.current = item.survey_id;
    setCapture({
      phase: 'confirm',
      at: [item.pos.x, item.pos.y],
      hCm: Math.round(item.pos.h * 100),
      note: '',
      address: docRef.current.phones[0]?.bermuda_address ?? '',
      surveyId: item.survey_id ?? undefined,
    });
  }, []);

  const place = useCallback(
    (key: string, fresh: NewDevice, x: number, y: number) => {
      const base = docRef.current.devices[key] ?? fresh;
      const snapped = defaultSnap(base) ? snapToWall(docRef.current.plan.walls, x, y, wallSnapRadius(scaleRef.current)) : null;
      queue.apply({ target: 'map', op: { kind: 'place', key, at: stamp(), x: snapped?.x ?? x, y: snapped?.y ?? y, device: fresh } });
      setSelection({ kind: 'device', key });
      setCollapsed(false);
    },
    [queue]
  );

  function handleGesture(event: GestureEvent) {
    if (event.type === 'gesture-start') {
      if (capture.phase === 'running') cancelCapture();
      return;
    }
    if (event.type === 'tap') {
      const world: Point = [round2(event.world[0]), round2(event.world[1])];
      if (capture.phase === 'running') return cancelCapture();
      if (event.hit.kind === 'survey' && event.hit.id) return openSurveyPoint(event.hit.id);
      if (capture.phase === 'aim' || capture.phase === 'confirm') {
        const base =
          capture.phase === 'confirm'
            ? capture
            : { hCm: heightCm.current, note: '', address: doc.phones[0]?.bermuda_address ?? '', surveyId: undefined };
        setCapture({ phase: 'confirm', at: world, hCm: base.hCm, note: base.note, address: base.address, surveyId: base.surveyId });
        return;
      }
      const armed = edit && selection?.kind === 'tray' ? tray.find(item => item.id === selection.id) : undefined;
      if (armed) {
        const fresh = armed.candidate ? deviceFromCandidate(armed.candidate) : doc.devices[armed.id];
        place(armed.id, fresh, world[0], world[1]);
        return;
      }
      const { hit } = event;
      if (hit.kind === 'handle') return;
      setSheet(null);
      if (hit.kind === 'marker' && hit.id) {
        setSelection({ kind: 'device', key: hit.id });
        setCollapsed(false);
        revealDevice(hit.id);
      } else if (hit.kind === 'ghost' && hit.id) setSelection({ kind: 'ghost', id: hit.id });
      else if (hit.kind === 'fingerprint' && hit.id) setSelection({ kind: 'fingerprint', id: hit.id });
      else if (hit.kind === 'zone' && hit.id) setSelection({ kind: 'zone', id: hit.id, at: world });
      else setSelection({ kind: 'point', at: world });
      return;
    }
    if (event.type === 'drag-start') {
      const key = event.hit.id;
      if (event.hit.kind === 'ghost') {
        const ghost = ghosts.find(candidate => candidate.id === key);
        if (!ghost) return;
        dragOrigin.current = { key: ghost.id, x: ghost.at[0], y: ghost.at[1], kind: 'ghost', last: null };
        setSelection(null);
        return;
      }
      const pos = key ? doc.devices[key]?.placement.pos : null;
      if (!key || !pos) return;
      dragOrigin.current = { key, x: pos.x, y: pos.y, kind: event.hit.kind === 'handle' ? 'facing' : 'move', last: null };
      setCollapsed(true);
      return;
    }
    if (event.type === 'drag-move') {
      const origin = dragOrigin.current;
      if (origin?.kind === 'ghost') {
        const ghost = ghosts.find(candidate => candidate.id === origin.key);
        let x = origin.x + (event.world[0] - event.startWorld[0]);
        let y = origin.y + (event.world[1] - event.startWorld[1]);
        const snapped = ghost && defaultSnap(ghost.device) ? snapToWall(doc.plan.walls, x, y, wallSnapRadius(scaleRef.current)) : null;
        if (snapped) [x, y] = [snapped.x, snapped.y];
        origin.last = { kind: 'ghost', id: origin.key, x, y };
        setDrag(origin.last);
        return;
      }
      const device = origin ? doc.devices[origin.key] : undefined;
      if (!origin || !device) return;
      if (origin.kind === 'move') {
        let x = origin.x + (event.world[0] - event.startWorld[0]);
        let y = origin.y + (event.world[1] - event.startWorld[1]);
        const snapped = snapFor(origin.key, device) ? snapToWall(doc.plan.walls, x, y, wallSnapRadius(scaleRef.current)) : null;
        if (snapped) [x, y] = [snapped.x, snapped.y];
        origin.last = { kind: 'move', key: origin.key, x, y };
      } else {
        const deg = bearingTo({ x: origin.x, y: origin.y, h: null }, event.world[0], event.world[1]);
        if (deg === null) return;
        if (origin.last?.kind === 'facing' && origin.last.deg !== deg) hapticTick();
        origin.last = { kind: 'facing', key: origin.key, deg };
      }
      setDrag(origin.last);
      return;
    }
    if (event.type === 'drag-end') {
      const origin = dragOrigin.current;
      const last = origin?.last ?? null;
      dragOrigin.current = null;
      setDrag(null);
      setCollapsed(false);
      if (last?.kind === 'ghost') {
        const item = pendingItems.find(candidate => candidate.id === last.id);
        if (!edit || (item?.kind !== 'placement' && item?.kind !== 'new_device')) return;
        apply(at => ({ kind: 'accept', item, at, place: [last.x, last.y] }));
        setSelection({ kind: 'device', key: item.kind === 'placement' ? item.device_key : newDeviceKey(item.device, item.id) });
        return;
      }
      if (!origin || !last || !edit || selectedKey !== origin.key) return;
      if (last.kind === 'move') {
        if (round2(last.x) !== origin.x || round2(last.y) !== origin.y)
          apply(at => ({ kind: 'move', key: last.key, at, x: last.x, y: last.y }));
      } else {
        apply(at => ({ kind: 'facing', key: last.key, at, facing: { state: 'known', deg: last.deg } }));
      }
      return;
    }
    if (event.type === 'drag-cancel') {
      dragOrigin.current = null;
      setDrag(null);
      setCollapsed(false);
    }
  }

  function revealDevice(key: string) {
    const pos = doc.devices[key]?.placement.pos;
    if (pos) viewport.reveal(pos.x, pos.y, window.innerWidth < SIDE_PANEL_MIN_PX ? SHEET_COVER : 0);
  }

  const selectedPos = selectedDevice?.placement.pos;
  const handleAt =
    edit && selectedDevice && selectedPos && isRadar(selectedDevice) ? handlePoint(selectedPos, selectedDevice.placement.facing) : null;

  const markerPoints = useMemo(
    () =>
      Object.entries(doc.devices).flatMap(([key, device]) =>
        device.placement.pos && typeVisible(layers, device.type, device.roles)
          ? [{ key, x: device.placement.pos.x, y: device.placement.pos.y }]
          : []
      ),
    [doc.devices, layers]
  );

  const viewport = usePlanViewport({
    plan: doc.plan,
    initialView: saved.view,
    draggable: (hit: Hit) =>
      edit &&
      (hit.kind === 'ghost'
        ? layers.suggestions && !ghosts.find(candidate => candidate.id === hit.id)?.box
        : selectedKey !== null && hit.id === selectedKey && (hit.kind === 'marker' || hit.kind === 'handle')),
    refineHit: (hit, px, shown, size) => {
      if (hit.kind === 'survey') {
        const id = markerNear(surveyTargets, shown, size, px, SURVEY_HIT_PX);
        return id ? { kind: 'survey', id } : hit;
      }
      if (hit.kind === 'ghost' || hit.kind === 'fingerprint') return hit;
      const handle = shown.s >= HANDLE_MIN_PX_PER_M ? handleAt : null;
      const targets = handle ? [...markerPoints, { key: HANDLE_KEY, x: handle[0], y: handle[1] }] : markerPoints;
      const key = markerNear(targets, shown, size, px, HIT_RADIUS_PX, selectedKey);
      return key === HANDLE_KEY ? { kind: 'handle', id: selectedKey } : key ? { kind: 'marker', id: key } : hit;
    },
    onEvent: handleGesture,
  });
  const { centreOn, zoomBy, fit, panByMetres, reveal, cancelGestures } = viewport;

  useEffect(() => cancelGestures(), [selectedKey, edit, cancelGestures]);

  /** A to-do or skipped point opens the capture sheet at its place; a point that was captured opens its fingerprint. */
  const openSurveyPoint = useCallback(
    (id: string) => {
      const { points, progress: current } = surveyRef.current;
      const point = points.find(candidate => candidate.id === id);
      if (!point) return;
      lastPoint.current = id;
      setSheet(null);
      const done = current.latest[id];
      const [x, y] = done ? [done.pos.x, done.pos.y] : point.at;
      reveal(x, y, window.innerWidth < SIDE_PANEL_MIN_PX ? SHEET_COVER : 0);
      if (done) {
        setCapture({ phase: 'idle' });
        setSelection({ kind: 'fingerprint', id: done.id });
        return;
      }
      setSelection(null);
      setCapture(previous => {
        const carry = previous.phase === 'confirm' ? previous : null;
        return {
          phase: 'confirm',
          at: point.at,
          hCm: carry?.hCm ?? heightCm.current,
          note: '',
          address: carry?.address ?? docRef.current.phones[0]?.bermuda_address ?? '',
          surveyId: id,
        };
      });
    },
    [reveal]
  );

  const actions = useMemo<DeviceActions>(
    () => ({
      move: (key, x, y) => apply(at => ({ kind: 'move', key, at, x, y })),
      facing: (key, facing: Facing) => apply(at => ({ kind: 'facing', key, at, facing })),
      height: (key, h) => apply(at => ({ kind: 'height', key, at, h })),
      confirm: (key, confirmed) => apply(at => ({ kind: 'confirm', key, at, confirmed })),
      undo: key => apply(at => ({ kind: 'undo', key, at })),
      unplace: key => apply(at => ({ kind: 'unplace', key, at })),
      setType: (key, type) => apply(at => ({ kind: 'type', key, at, type })),
      accept: item => apply(at => ({ kind: 'accept', item, at })),
      reject: id => apply(at => ({ kind: 'reject', id, at })),
      openRef: id => setSheet({ kind: 'questions', focus: id }),
    }),
    [apply]
  );

  const jumpTo = useCallback(
    (key: string) => {
      const pos = docRef.current.devices[key]?.placement.pos;
      if (!pos) return;
      setSelection({ kind: 'device', key });
      setSheet(null);
      setCollapsed(false);
      centreOn(pos.x, pos.y, 60, window.innerWidth < SIDE_PANEL_MIN_PX ? window.innerHeight * 0.18 : 0);
    },
    [centreOn]
  );

  /** Centres the plan on a suggestion's marker and selects it; a rename shows the device it renames. */
  const showSuggestion = (item: SuggestItem) => {
    if (item.kind === 'rename') return jumpTo(item.device_key);
    const ghost = ghosts.find(candidate => candidate.id === item.id);
    if (!ghost) return;
    setLayers(current => (current.suggestions ? current : { ...current, suggestions: true }));
    setSheet(null);
    setSelection({ kind: 'ghost', id: ghost.id });
    centreOn(ghost.at[0], ghost.at[1], 60, window.innerWidth < SIDE_PANEL_MIN_PX ? window.innerHeight * 0.18 : 0);
  };

  const activate = useCallback(
    (key: string) => {
      const pos = docRef.current.devices[key]?.placement.pos;
      setSelection({ kind: 'device', key });
      setCollapsed(false);
      if (pos) reveal(pos.x, pos.y, window.innerWidth < SIDE_PANEL_MIN_PX ? SHEET_COVER : 0);
    },
    [reveal]
  );

  const activateGhost = useCallback((id: string) => setSelection({ kind: 'ghost', id }), []);
  const activatePrint = useCallback((id: string) => setSelection({ kind: 'fingerprint', id }), []);

  const armTray = useCallback((id: string | null) => setSelection(id === null ? null : { kind: 'tray', id }), []);

  const startCapture = useCallback(
    async (details: Extract<Capture, { phase: 'confirm' }>) => {
      const current = docRef.current;
      const phone = current.phones.find(candidate => candidate.bermuda_address === details.address) ?? null;
      const source = current.wifi.source;
      if (!connection || (!phone && !source)) return;
      const controller = new AbortController();
      const skip = new AbortController();
      captureAbort.current = controller;
      wifiSkip.current = skip;
      hiddenAbort.current = false;
      heightCm.current = details.hCm;
      if (details.surveyId) lastPoint.current = details.surveyId;
      setCaptureError(null);
      setCaptureResult(null);
      setCapture({ phase: 'running', at: details.at, elapsedS: 0, surveyId: details.surveyId });
      const releaseScreen = keepScreenOn();
      const onProgress = (elapsedS: number) =>
        setCapture(previous => (previous.phase === 'running' && elapsedS > previous.elapsedS ? { ...previous, elapsedS } : previous));
      const onWait = (waitedS: number) => {
        const waitS = Math.floor(waitedS);
        setCapture(previous => (previous.phase === 'running' && waitS !== previous.waitS ? { ...previous, waitS } : previous));
      };
      try {
        const config: CaptureConfig = {
          phone: phone ? { name: phone.name, bermuda_address: phone.bermuda_address } : { name: source?.name ?? '', bermuda_address: '' },
          pos: { x: details.at[0], y: details.at[1], h: round2(details.hCm / 100) },
          layoutVersion: current.layout_version,
          windowS: CAPTURE_WINDOW_S,
        };
        const bluetooth = phone
          ? runCapture({
              config,
              poll: async () => dumpOf(await fetchDump(connection, [phone.bermuda_address]), phone.bermuda_address),
              wait: abortableWait,
              signal: controller.signal,
              onProgress,
            })
          : Promise.resolve(beginCapture(config, null));
        const wifiRun = source
          ? runWifi({
              windowS: CAPTURE_WINDOW_S,
              send: () => sendUpdateCommand(connection, source.notify),
              read: () => readWifi(useHass.getState().entities, source),
              wait: abortableWait,
              now: Date.now,
              signal: controller.signal,
              skip: skip.signal,
              onProgress,
              onWait,
            })
          : Promise.resolve({ wifi: noWifi('not_captured'), error: null });
        const [state, { wifi, error }] = await Promise.all([bluetooth, wifiRun]);
        const entities = useHass.getState().entities;
        const zones = docRef.current.plan.zones;
        const roomActive = Object.fromEntries(
          zones.map(zone => [zone.zone_id, zone.active_entity ? (entities[zone.active_entity]?.state ?? 'unknown') : 'unknown'])
        );
        const item = finishCapture(state, {
          at: new Date().toISOString(),
          note: details.note.trim(),
          zones,
          devices: docRef.current.devices,
          roomActive,
          wifi,
          surveyId: details.surveyId ?? null,
        });
        queue.apply({ target: 'fingerprints', op: { kind: 'fingerprint', item, at: item.at } });
        setCapture({ phase: 'idle' });
        if (details.surveyId) {
          const point = surveyRef.current.points.find(candidate => candidate.id === details.surveyId);
          const apKey = wifi.bssid ? docRef.current.wifi.aps[wifi.bssid] : undefined;
          const ap = (apKey ? docRef.current.devices[apKey]?.name : undefined) ?? null;
          setCaptureResult(resultText(point ? `Point ${point.n}` : 'Capture', wifi, ap, error));
        } else setSelection({ kind: 'fingerprint', id: item.id });
      } catch (failure) {
        controller.abort();
        if (!(failure instanceof CaptureCancelled)) setCaptureError(failure instanceof Error ? failure.message : String(failure));
        else if (hiddenAbort.current) setCaptureError(CAPTURE_HIDDEN);
        setCapture({ phase: 'idle' });
      } finally {
        releaseScreen();
        if (captureAbort.current === controller) captureAbort.current = null;
        if (wifiSkip.current === skip) wifiSkip.current = null;
      }
    },
    [connection, queue]
  );

  const view = viewport.view;
  useLayoutEffect(() => {
    if (view) scaleRef.current = view.s;
  });

  useEffect(() => {
    const timer = setTimeout(() => saveUi({ layers, view, skipped: [...skipped] }), 400);
    return () => clearTimeout(timer);
  }, [layers, view, skipped]);

  useEffect(() => {
    const onHide = () => {
      queue.saveDrafts();
      void queue.flush();
      if (captureAbort.current) {
        hiddenAbort.current = true;
        captureAbort.current.abort();
      }
    };
    const onVisibility = () => {
      if (document.hidden) onHide();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      captureAbort.current?.abort();
    };
  }, [queue]);

  const close = useCallback(async () => {
    captureAbort.current?.abort();
    if (await queue.flush()) onClose();
  }, [queue, onClose]);

  const nudge = (dx: number, dy: number, event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.25 : event.altKey ? 0.01 : 0.05;
    const pos = selectedDevice?.placement.pos;
    if (edit && selectedKey && pos) actions.move(selectedKey, round2(pos.x + dx * step), round2(pos.y + dy * step));
    else panByMetres(dx * (event.shiftKey ? 2 : 0.5), dy * (event.shiftKey ? 2 : 0.5));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTyping(event.target)) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === 'z' && selectedKey) {
        event.preventDefault();
        actions.undo(selectedKey);
      }
      return;
    }
    switch (event.key) {
      case '+':
      case '=':
        return zoomBy(1.4);
      case '-':
      case '_':
        return zoomBy(1 / 1.4);
      case '0':
        return fit();
      case 'ArrowLeft':
        event.preventDefault();
        return nudge(-1, 0, event);
      case 'ArrowRight':
        event.preventDefault();
        return nudge(1, 0, event);
      case 'ArrowUp':
        event.preventDefault();
        return nudge(0, 1, event);
      case 'ArrowDown':
        event.preventDefault();
        return nudge(0, -1, event);
      case '[':
      case ']': {
        if (!edit || !selectedKey || !selectedDevice || !isRadar(selectedDevice)) return;
        const facing = selectedDevice.placement.facing;
        const from = facing.state === 'known' ? facing.deg : 0;
        return actions.facing(selectedKey, {
          state: 'known',
          deg: normalizeDeg(from + (event.key === ']' ? FACING_STEP_DEG : -FACING_STEP_DEG)),
        });
      }
      case 'Escape':
        if (capture.phase !== 'idle') return cancelCapture();
        if (sheet) return setSheet(null);
        if (selection) return setSelection(null);
    }
  };

  const printBytes = useMemo(() => fingerprintBytes(prints), [prints]);
  const blePrints = useMemo(() => prints.items.filter(item => item.bermuda_address !== ''), [prints.items]);
  const weakCount = blePrints.filter(item => item.weak).length;
  const shownPrints = useMemo(() => (weakOnly ? blePrints.filter(item => item.weak) : blePrints), [weakOnly, blePrints]);
  const unanswered = doc.questions.filter(question => !question.answer).length;
  const hiddenTypes = hiddenTypeCount(layers, doc.types);
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const device of Object.values(doc.devices)) {
      for (const key of new Set([device.type, ...device.roles])) counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [doc.devices]);
  const toggleType = (key: string) =>
    setLayers(current => ({
      ...current,
      hiddenTypes: current.hiddenTypes.includes(key) ? current.hiddenTypes.filter(item => item !== key) : [...current.hiddenTypes, key],
    }));
  const setAllTypes = (visible: boolean) =>
    setLayers(current => ({ ...current, hiddenTypes: visible ? [] : doc.types.map(type => type.key) }));
  const toggle = (name: Switch) => setLayers(current => ({ ...current, [name]: !current[name] }));
  const toggleSheet = (kind: 'suggestions' | 'layers') => setSheet(current => (current?.kind === kind ? null : { kind }));

  const ghostSelected = selection?.kind === 'ghost' ? ghosts.find(ghost => ghost.id === selection.id) : undefined;
  const ghostItem = ghostSelected ? pendingItems.find(item => item.id === ghostSelected.id) : undefined;
  const zoneSelected = selection?.kind === 'zone' ? doc.plan.zones.find(zone => zone.zone_id === selection.id) : undefined;
  const printSelected = selection?.kind === 'fingerprint' ? prints.items.find(item => item.id === selection.id) : undefined;
  const trayArmed = selection?.kind === 'tray' ? tray.find(item => item.id === selection.id) : undefined;
  const phoneSheet = sheet?.kind === 'phone' ? phones.statuses.find(status => status.phone.bermuda_address === sheet.address) : undefined;
  const crosshair: Point | null =
    capture.phase === 'confirm' || capture.phase === 'running'
      ? capture.at
      : selection?.kind === 'point'
        ? selection.at
        : selection?.kind === 'zone'
          ? (selection.at ?? null)
          : null;
  const surveyPoint = capture.phase === 'confirm' && capture.surveyId ? surveyPts.find(point => point.id === capture.surveyId) : undefined;
  const surveyTarget: SurveyTarget | null = surveyPoint
    ? {
        n: surveyPoint.n,
        label: surveyPoint.label,
        skipped: skipped.has(surveyPoint.id),
        onSkip: () => {
          setSkip(surveyPoint.id, true);
          setCapture({ phase: 'idle' });
        },
        onRestore: () => setSkip(surveyPoint.id, false),
      }
    : null;
  /** Decides one suggested setup, and closes the sheet when that was the last one waiting. */
  const decideSetup = (decide: () => void) => {
    decide();
    if (setupProposals.length <= 1) setSheet(null);
  };
  /** Decides one suggestion, and closes the sheet when that was the last one waiting. */
  const decideSuggestion = (decide: () => void) => {
    decide();
    if (pendingItems.length <= 1) setSheet(null);
  };
  const goNext = () => {
    const point = nextPoint(surveyPts, progress, lastPoint.current);
    if (!point) return;
    centreOn(point.at[0], point.at[1], 60, window.innerWidth < SIDE_PANEL_MIN_PX ? window.innerHeight * 0.18 : 0);
    openSurveyPoint(point.id);
  };
  const bar = view ? scaleBarLength(view.s) : 1;
  const idle = capture.phase !== 'confirm' && !sheet;

  return (
    <div
      className='sm-workspace'
      data-theme={layers.light ? 'light' : 'dark'}
      data-tray={edit && (tray.length > 0 || candidateError !== null)}
    >
      <div className='sm-col'>
        <header className='sm-header'>
          <div className='sm-header-row'>
            <button type='button' className='sm-icon-btn' onClick={() => void close()} aria-label='Close the map'>
              <Icon icon='mdi:chevron-left' />
            </button>
            <h1 className='sm-title'>Sensor map</h1>
            <span
              className={`sm-save ${snapshot.state}`}
              role='status'
              title={
                snapshot.error ??
                `${prints.items.length} fingerprints, ${Math.round(printBytes / 1000)} of ${Math.round(prints.limit_bytes / 1000)} KB`
              }
            >
              <span className='sm-dot' />
              {SAVE_TEXT[snapshot.state]}
              {snapshot.state === 'failed' && (
                <button type='button' className='sm-link' onClick={() => void queue.flush()}>
                  Retry
                </button>
              )}
              {snapshot.state === 'saved' && prints.items.length > 0 && layers.fingerprints && (
                <span className='sm-muted'>
                  · {prints.items.length} {prints.items.length === 1 ? 'fingerprint' : 'fingerprints'}
                </span>
              )}
            </span>
            {pendingItems.length > 0 && (
              <button
                type='button'
                className='sm-pill'
                aria-expanded={sheet?.kind === 'suggestions'}
                onClick={() => toggleSheet('suggestions')}
              >
                <Icon icon='mdi:lightbulb-on-outline' />
                {pendingItems.length} {pendingItems.length === 1 ? 'suggestion' : 'suggestions'}
              </button>
            )}
            <button
              type='button'
              className='sm-icon-btn'
              aria-label={hiddenTypes > 0 ? `Layers, ${hiddenTypes} hidden` : 'Layers'}
              aria-expanded={sheet?.kind === 'layers'}
              onClick={() => toggleSheet('layers')}
            >
              <Icon icon='mdi:layers-outline' />
              {hiddenTypes > 0 && (
                <span className='sm-badge' aria-hidden='true'>
                  {hiddenTypes}
                </span>
              )}
            </button>
          </div>
          <div className='sm-mode-row'>
            <ModeControl mode={mode} onChange={setMode} />
            <button
              type='button'
              className='sm-icon-btn'
              aria-label={unanswered > 0 ? `Questions, ${unanswered} open` : 'Questions'}
              onClick={() => setSheet({ kind: 'questions', focus: null })}
            >
              <Icon icon='mdi:comment-question-outline' />
              {unanswered > 0 && (
                <span className='sm-badge' aria-hidden='true'>
                  {unanswered}
                </span>
              )}
            </button>
          </div>
          {layers.survey && (
            <SurveyBar
              progress={progress}
              wifi={wifiReady}
              setup={setup}
              result={captureResult}
              busy={capture.phase === 'running'}
              onNext={goNext}
              onSetup={() => setSheet({ kind: 'setup' })}
            />
          )}
          {layers.coverage && <CoverageBar choices={apOptions} selected={apSelected} shown={shownCoverage.length} onSelect={setApFilter} />}
        </header>

        <div
          className='sm-main'
          ref={viewport.containerRef}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role='group'
          aria-label='Map. Arrow keys pan, plus and minus zoom, zero fits the plan.'
          data-edit={edit}
        >
          <PlanCanvas
            doc={doc}
            view={view}
            size={viewport.size}
            svgRef={viewport.svgRef}
            pointerHandlers={viewport.pointerHandlers}
            layers={layers}
            edit={edit}
            selection={selection}
            drag={drag}
            scannerSources={scannerSources}
            ghosts={ghosts}
            fingerprints={shownPrints}
            phoneAreas={areas}
            crosshair={crosshair}
            survey={surveyView}
            coverage={coverageView}
            onActivate={activate}
            onActivateGhost={activateGhost}
            onActivatePrint={activatePrint}
            onActivateSurvey={openSurveyPoint}
          />
          <div className='sm-zoom'>
            <button type='button' className='sm-icon-btn' onClick={() => zoomBy(1.6)} aria-label='Zoom in'>
              <Icon icon='mdi:plus' />
            </button>
            <button type='button' className='sm-icon-btn' onClick={() => zoomBy(1 / 1.6)} aria-label='Zoom out'>
              <Icon icon='mdi:minus' />
            </button>
            <button type='button' className='sm-icon-btn' onClick={fit} aria-label='Fit the plan'>
              <Icon icon='mdi:fit-to-screen-outline' />
            </button>
          </div>
          {view && (
            <div className='sm-scale' aria-hidden='true'>
              <span>{bar < 1 ? `${bar * 100} cm` : `${bar} m`}</span>
              <div className='sm-scale-bar' style={{ width: bar * view.s }} />
            </div>
          )}
          {crosshair && selection && (selection.kind === 'point' || selection.kind === 'zone') && (
            <div className='sm-point'>
              x {crosshair[0].toFixed(2)} m, y {crosshair[1].toFixed(2)} m
            </div>
          )}
          {captureError && (
            <div className='sm-point warn' role='alert'>
              Capture failed: {captureError}
            </div>
          )}
          {suggest.problem && <div className='sm-point warn'>Suggestions unreadable: {suggest.problem}</div>}
          {(layers.phones || layers.survey || capture.phase !== 'idle') && (
            <PhoneLayer
              statuses={phones.statuses}
              error={phones.error}
              zones={doc.plan.zones}
              phonesConfigured={doc.phones.length > 0}
              chips={layers.phones}
              fab={layers.phones || layers.survey}
              setup={setup}
              onSetup={() => setSheet({ kind: 'setup' })}
              canCapture={canCapture}
              capture={capture}
              onAim={() => setCapture({ phase: 'aim' })}
              onCancelCapture={cancelCapture}
              onSkipWifi={() => wifiSkip.current?.abort()}
              onScanners={address => setSheet({ kind: 'phone', address })}
            />
          )}
        </div>

        {edit && (
          <UnplacedTray items={tray} armedId={selection?.kind === 'tray' ? selection.id : null} error={candidateError} onArm={armTray} />
        )}
      </div>

      {capture.phase === 'confirm' && (
        <CaptureSheet
          at={capture.at}
          hCm={capture.hCm}
          note={capture.note}
          address={capture.address}
          phones={doc.phones}
          canStart={canCapture}
          wifi={wifiReady}
          survey={surveyTarget}
          onChange={patch => setCapture(current => (current.phase === 'confirm' ? { ...current, ...patch } : current))}
          onSave={() => void startCapture(capture)}
          onCancel={cancelCapture}
        />
      )}
      {capture.phase !== 'confirm' && sheet?.kind === 'questions' && (
        <QuestionsSheet
          doc={doc}
          proposals={answerProposals}
          focusId={sheet.focus}
          onAnswer={(id, answer) => apply(at => ({ kind: 'answer', id, at, answer }))}
          onAccept={actions.accept}
          onReject={actions.reject}
          onJump={jumpTo}
          onClose={() => setSheet(null)}
        />
      )}
      {capture.phase !== 'confirm' && sheet?.kind === 'phone' && phoneSheet && (
        <PhoneSheet status={phoneSheet} doc={doc} onClose={() => setSheet(null)} />
      )}
      {capture.phase !== 'confirm' && sheet?.kind === 'setup' && (
        <SetupSheet
          items={setupProposals}
          doc={doc}
          onAccept={item => decideSetup(() => actions.accept(item))}
          onReject={id => decideSetup(() => actions.reject(id))}
          onClose={() => setSheet(null)}
        />
      )}
      {capture.phase !== 'confirm' && sheet?.kind === 'suggestions' && (
        <SuggestionsSheet
          items={pendingItems}
          doc={doc}
          ghosts={ghosts}
          onAccept={item => decideSuggestion(() => actions.accept(item))}
          onReject={id => decideSuggestion(() => actions.reject(id))}
          onShow={showSuggestion}
          onClose={() => setSheet(null)}
        />
      )}
      {capture.phase !== 'confirm' && sheet?.kind === 'layers' && (
        <LayersSheet
          layers={layers}
          types={doc.types}
          counts={typeCounts}
          fingerprints={prints.items.length}
          weak={weakCount}
          weakOnly={weakOnly}
          suggestions={pendingItems.length}
          onType={toggleType}
          onAllTypes={setAllTypes}
          onSwitch={toggle}
          onWeakOnly={() => setWeakOnly(value => !value)}
          onClose={() => setSheet(null)}
        />
      )}
      {idle && selectedDevice && selectedKey && (
        <DeviceSheet
          key={selectedKey}
          id={selectedKey}
          device={selectedDevice}
          doc={doc}
          edit={edit}
          collapsed={collapsed}
          snap={snapFor(selectedKey, selectedDevice)}
          pending={pendingItems.filter(
            (item): item is Extract<SuggestItem, { kind: 'placement' | 'rename' }> =>
              (item.kind === 'placement' || item.kind === 'rename') && item.device_key === selectedKey
          )}
          onToggle={() => setCollapsed(value => !value)}
          onSnap={on => setSnapOverride({ key: selectedKey, on })}
          onClose={() => setSelection(null)}
          actions={actions}
        />
      )}
      {idle && trayArmed && edit && (
        <TraySheet
          name={trayArmed.name}
          model={trayArmed.candidate?.model ?? ''}
          candidate={trayArmed.candidate}
          onIgnore={ids => {
            const at = stamp();
            for (const id of ids) queue.apply({ target: 'map', op: { kind: 'ignore', device_id: id, at } });
            setSelection(null);
          }}
          onCancel={() => armTray(null)}
        />
      )}
      {idle && ghostSelected && ghostItem && (
        <GhostSheet
          ghost={ghostSelected}
          item={ghostItem}
          edit={edit}
          onAccept={actions.accept}
          onReject={actions.reject}
          onClose={() => setSelection(null)}
        />
      )}
      {idle && zoneSelected && <ZoneSheet zone={zoneSelected} doc={doc} onClose={() => setSelection(null)} />}
      {idle && printSelected && (
        <FingerprintSheet
          item={printSelected}
          doc={doc}
          onDelete={id => {
            queue.apply({ target: 'fingerprints', op: { kind: 'remove_fingerprint', id, at: stamp() } });
            setSelection(null);
          }}
          onRetake={printSelected.survey_id ? retake : undefined}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
