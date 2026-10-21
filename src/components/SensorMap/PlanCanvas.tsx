import { memo, useMemo, type CSSProperties, type RefObject } from 'react';
import type { CoveragePoint, RoomCoverage } from '../../sensorMap/coverage';
import { fitView, markerRadiusPx, viewBoxOf, type Size, type View } from '../../sensorMap/geometry';
import { HANDLE_MIN_PX_PER_M } from '../../sensorMap/radarRange';
import { isRadar, type Facing, type Fingerprint, type MapDoc, type MapDevice, type Point } from '../../sensorMap/mapDoc';
import { normalizeMac } from '../../sensorMap/registry';
import type { SurveyPoint, SurveyProgress } from '../../sensorMap/survey';
import { CoverageDots, CoverageFills } from './CoverageLayer';
import { DeviceMarker } from './DeviceMarker';
import { Crosshair, FacingHandle, FingerprintMarks, GhostMarker, type Ghost } from './MarkLayers';
import { PlanDefs, PlanFurniture, PlanGrid, PlanLabels, PlanWalls } from './PlanLayers';
import { RadarFootprint } from './RadarFootprint';
import { SurveyLayer } from './SurveyLayer';
import { ZoneFills } from './ZoneFills';
import { typeVisible, type DragPreview, type Layers, type Selection } from './types';
import type { PlanViewport } from './usePlanViewport';

export interface SurveyView {
  points: readonly SurveyPoint[];
  progress: SurveyProgress;
  /** The point being captured. */
  activeId: string | null;
}

export interface CoverageView {
  rooms: readonly RoomCoverage[];
  points: readonly CoveragePoint[];
  nameOf: (key: string) => string | undefined;
}

interface PlanCanvasProps {
  doc: MapDoc;
  view: View | null;
  size: Size;
  svgRef: RefObject<SVGSVGElement | null>;
  pointerHandlers: PlanViewport['pointerHandlers'];
  layers: Layers;
  edit: boolean;
  selection: Selection | null;
  drag: DragPreview | null;
  scannerSources: ReadonlySet<string> | null;
  ghosts: readonly Ghost[];
  fingerprints: readonly Fingerprint[];
  phoneAreas: ReadonlySet<string>;
  crosshair: Point | null;
  survey: SurveyView | null;
  coverage: CoverageView | null;
  onActivate: (id: string) => void;
  onActivateGhost: (id: string) => void;
  onActivatePrint: (id: string) => void;
  onActivateSurvey: (id: string) => void;
}

interface Placed {
  key: string;
  device: MapDevice;
  x: number;
  y: number;
  h: number | null;
}

function placedDevices(devices: Record<string, MapDevice>): Placed[] {
  const out: Placed[] = [];
  for (const [key, device] of Object.entries(devices)) {
    const pos = device.placement.pos;
    if (pos) out.push({ key, device, x: pos.x, y: pos.y, h: pos.h });
  }
  return out;
}

/** The plan as one SVG. The static layers are memoised on the plan, every marker and footprint on its own
 * device, so a pan or zoom redraws the viewBox and nothing inside it. */
export const PlanCanvas = memo(function PlanCanvas(props: PlanCanvasProps) {
  const {
    doc,
    view,
    size,
    svgRef,
    pointerHandlers,
    layers,
    edit,
    selection,
    drag,
    scannerSources,
    ghosts,
    fingerprints,
    phoneAreas,
    crosshair,
    survey,
    coverage,
    onActivate,
    onActivateGhost,
    onActivatePrint,
    onActivateSurvey,
  } = props;
  const { plan } = doc;
  const yTop = plan.bounds.y1;
  // Until the canvas has been measured there is no scale; the plan's own frame stands in for one frame.
  const measured = view !== null && size.w > 0 && size.h > 0;
  const shown = view ?? fitView({ w: Math.max(size.w, 1), h: Math.max(size.h, 1) }, plan.fit);
  const box = measured
    ? viewBoxOf(shown, size, yTop)
    : { x: plan.fit.x0, y: yTop - plan.fit.y1, w: plan.fit.x1 - plan.fit.x0, h: plan.fit.y1 - plan.fit.y0 };
  const radius = markerRadiusPx(shown.s);
  const style = { '--ks': 1 / shown.s, '--k': radius / 10 / shown.s } as CSSProperties;
  const placed = useMemo(() => placedDevices(doc.devices), [doc.devices]);
  const selectedKey = selection?.kind === 'device' ? selection.key : null;

  const at = (item: Placed) => {
    if (drag?.kind === 'move' && drag.key === item.key) return { x: drag.x, y: drag.y };
    return { x: item.x, y: item.y };
  };
  const facingOf = (item: Placed): Facing =>
    drag?.kind === 'facing' && drag.key === item.key ? { state: 'known', deg: drag.deg } : item.device.placement.facing;

  const visible = placed.filter(item => typeVisible(layers, item.device.type, item.device.roles));
  const ordered = [...visible.filter(item => item.key !== selectedKey), ...visible.filter(item => item.key === selectedKey)];
  const radars = visible.filter(item => isRadar(item.device));
  const selected = selectedKey ? placed.find(item => item.key === selectedKey) : undefined;
  const selectedPos = selected ? at(selected) : null;

  return (
    <svg
      ref={svgRef}
      className='sm-svg'
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={style}
      role='application'
      aria-label='Floor plan with sensors'
      tabIndex={-1}
      {...pointerHandlers}
    >
      <PlanDefs plan={plan} />
      {layers.grid && <PlanGrid plan={plan} />}
      <ZoneFills zones={plan.zones} yTop={yTop} selectedId={selection?.kind === 'zone' ? selection.id : null} phoneAreas={phoneAreas} />
      {coverage && <CoverageFills rooms={coverage.rooms} zones={plan.zones} yTop={yTop} />}
      <PlanFurniture plan={plan} />
      <PlanLabels plan={plan} />
      {layers.footprints && (
        <g className='sm-footprints'>
          {radars.map(item => {
            const place = at(item);
            return (
              <RadarFootprint
                key={item.key}
                id={item.key}
                device={item.device}
                x={place.x}
                y={place.y}
                h={item.h}
                facing={facingOf(item)}
                yTop={yTop}
                selected={item.key === selectedKey}
              />
            );
          })}
        </g>
      )}
      <PlanWalls plan={plan} />
      {layers.fingerprints && (
        <FingerprintMarks
          items={fingerprints}
          yTop={yTop}
          selectedId={selection?.kind === 'fingerprint' ? selection.id : null}
          onActivate={onActivatePrint}
        />
      )}
      <g className='sm-markers'>
        {ordered.map(item => {
          const place = at(item);
          const source = item.device.ha.scanner_source;
          return (
            <DeviceMarker
              key={item.key}
              id={item.key}
              device={item.device}
              x={place.x}
              y={place.y}
              yTop={yTop}
              selected={item.key === selectedKey}
              names={layers.names}
              scannerGone={scannerSources !== null && source !== null && !scannerSources.has(normalizeMac(source))}
              onActivate={onActivate}
            />
          );
        })}
      </g>
      {coverage && (
        <CoverageDots
          rooms={coverage.rooms}
          zones={plan.zones}
          points={coverage.points}
          yTop={yTop}
          nameOf={coverage.nameOf}
          onActivate={onActivatePrint}
        />
      )}
      {survey && (
        <SurveyLayer
          points={survey.points}
          progress={survey.progress}
          yTop={yTop}
          activeId={survey.activeId}
          onActivate={onActivateSurvey}
        />
      )}
      {layers.suggestions &&
        ghosts.map(ghost => (
          <GhostMarker
            key={ghost.id}
            ghost={drag?.kind === 'ghost' && drag.id === ghost.id ? { ...ghost, at: [drag.x, drag.y] } : ghost}
            yTop={yTop}
            selected={selection?.kind === 'ghost' && selection.id === ghost.id}
            onActivate={onActivateGhost}
          />
        ))}
      {edit && selected && selectedPos && isRadar(selected.device) && shown.s >= HANDLE_MIN_PX_PER_M && (
        <FacingHandle radar={selectedPos} facing={facingOf(selected)} deviceId={selected.key} yTop={yTop} />
      )}
      {crosshair && <Crosshair at={crosshair} yTop={yTop} />}
    </svg>
  );
});
