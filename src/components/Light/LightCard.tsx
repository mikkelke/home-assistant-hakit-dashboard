import { useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStringArray, attrStr } from '../../types';
import { useLocalStorageBoolean, useModalBackButton, useSwipeToClose, useTouchScrollSlopGuard } from '../../hooks';
import './LightCard.css';
import { ROOM_LIGHTS, ROOM_LIGHT_MANUAL_OVERRIDE } from '../../config/lights';

// "Lights" card in the Climate-card grammar (see AC/TonightCard): amber glyph disc, state word
// right, one row per light. The row IS the information: the dot wears the light's actual color,
// the strip is its brightness. Actions are icons/direct touches; words only state things.

interface LightCardProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

/** Kelvin -> screen color, anchored on the five presets the picker offers. */
const TEMP_ANCHORS: Array<{ k: number; hex: string }> = [
  { k: 2700, hex: '#ff9d45' },
  { k: 3000, hex: '#ffb46b' },
  { k: 4000, hex: '#ffd9a3' },
  { k: 5000, hex: '#f2f0e6' },
  { k: 6500, hex: '#dbe6ff' },
];

const DEFAULT_ON_COLOR = '#fbbf24';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map(c =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/** Linear blend between the two anchors that bracket `kelvin` (clamped outside the range). */
function kelvinToHex(kelvin: number): string {
  if (!Number.isFinite(kelvin)) return DEFAULT_ON_COLOR;
  if (kelvin <= TEMP_ANCHORS[0].k) return TEMP_ANCHORS[0].hex;
  const last = TEMP_ANCHORS[TEMP_ANCHORS.length - 1];
  if (kelvin >= last.k) return last.hex;
  for (let i = 1; i < TEMP_ANCHORS.length; i++) {
    const hi = TEMP_ANCHORS[i];
    const lo = TEMP_ANCHORS[i - 1];
    if (kelvin > hi.k) continue;
    const t = (kelvin - lo.k) / (hi.k - lo.k);
    const a = hexToRgb(lo.hex);
    const b = hexToRgb(hi.hex);
    return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return DEFAULT_ON_COLOR;
}

function darken(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * factor, g * factor, b * factor]);
}

/** Relative luminance, used only to keep the bulb glyph readable on any dot color. */
function isLightColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.35;
}

export function LightCard({ areaName, entities, callService }: LightCardProps) {
  // Collapsed by default, remembered across sessions (same pattern as TonightCard/HeatCard).
  const areaKey = areaName.toLowerCase().replace(/\s+/g, '_');
  const [collapsed, setCollapsed] = useLocalStorageBoolean(`lightcard-collapsed-${areaKey}`, true);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});
  // "Finger is on this light's strip" - suppresses the entity->slider sync while dragging.
  const [dragging, setDragging] = useState<Record<string, boolean>>({});
  const [colorPickerLightId, setColorPickerLightId] = useState<string | null>(null);
  // Optimistic state for immediate UI feedback
  const [optimisticStates, setOptimisticStates] = useState<Record<string, 'on' | 'off' | null>>({});
  // Track last committed values and timestamps to prevent UI flicker
  const lastCommittedRef = useRef<Record<string, { value: number; timestamp: number }>>({});
  const lightHeaderSlop = useTouchScrollSlopGuard();

  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');
  const roomLights = ROOM_LIGHTS[areaNameNormalized] || [];

  // Global mechanism: manual override toggle — ON pauses this room's automatic lighting.
  const overrideId = ROOM_LIGHT_MANUAL_OVERRIDE[areaNameNormalized];
  const overrideEntity = overrideId ? entities?.[overrideId] : undefined;
  const overrideOn = overrideEntity?.state === 'on';

  // Filter to only existing lights
  const availableLights = roomLights.filter(lightId => entities?.[lightId]);

  // Count lights that are on (with optimistic updates)
  const lightsOn = availableLights.filter(lightId => {
    const optimisticState = optimisticStates[lightId];
    if (optimisticState !== null && optimisticState !== undefined) {
      return optimisticState === 'on';
    }
    return entities[lightId]?.state === 'on';
  }).length;
  const someOn = lightsOn > 0;

  const handleToggleLight = useCallback(
    (lightId: string) => {
      if (!callService) return;
      const entity = entities[lightId];
      const currentState = entity?.state === 'on' ? 'on' : 'off';
      const newState = currentState === 'on' ? 'off' : 'on';

      // Optimistic update - immediately update UI
      setOptimisticStates(prev => ({ ...prev, [lightId]: newState }));

      // Clear optimistic state after a delay (when entity updates)
      setTimeout(() => {
        setOptimisticStates(prev => {
          const next = { ...prev };
          delete next[lightId];
          return next;
        });
      }, 1000);

      callService({
        domain: 'light',
        service: currentState === 'on' ? 'turn_off' : 'turn_on',
        target: { entity_id: lightId },
      });
    },
    [callService, entities]
  );

  // Check if light supports color
  const supportsColor = useCallback(
    (lightId: string): boolean => {
      const entity = entities[lightId];
      if (!entity) return false;
      const supportedColorModes = attrStringArray(entity.attributes?.supported_color_modes);
      return (
        supportedColorModes.includes('rgb') ||
        supportedColorModes.includes('hs') ||
        supportedColorModes.includes('xy') ||
        supportedColorModes.includes('color_temp')
      );
    },
    [entities]
  );

  // The dot is the color door for color-capable lights, and a plain switch for the rest.
  const handleDotClick = useCallback(
    (lightId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (supportsColor(lightId)) {
        setColorPickerLightId(lightId);
      } else {
        handleToggleLight(lightId);
      }
    },
    [supportsColor, handleToggleLight]
  );

  const handleColorSelect = useCallback(
    (lightId: string, rgb: [number, number, number]) => {
      if (!callService) return;
      callService({
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: lightId },
        serviceData: {
          rgb_color: rgb,
        },
      });
      setColorPickerLightId(null);
    },
    [callService]
  );

  const handleColorTempSelect = useCallback(
    (lightId: string, kelvin: number) => {
      if (!callService) return;
      callService({
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: lightId },
        serviceData: {
          color_temp_kelvin: kelvin,
        },
      });
      setColorPickerLightId(null);
    },
    [callService]
  );

  const handleBrightnessCommit = useCallback(
    (lightId: string, brightness: number) => {
      if (!callService) return;

      // Update local state immediately to prevent UI jump
      setSliderValues(prev => ({ ...prev, [lightId]: brightness }));

      // Track the committed value to prevent UI flicker
      lastCommittedRef.current[lightId] = { value: brightness, timestamp: Date.now() };

      if (brightness === 0) {
        callService({
          domain: 'light',
          service: 'turn_off',
          target: { entity_id: lightId },
        });
      } else {
        callService({
          domain: 'light',
          service: 'turn_on',
          target: { entity_id: lightId },
          serviceData: { brightness_pct: brightness },
        });
      }
    },
    [callService]
  );

  const getLightName = (lightId: string) => {
    const entity = entities[lightId];
    const full = attrStr(entity?.attributes?.friendly_name) || lightId.split('.')[1].replace(/_/g, ' ');
    // The light already lives inside its room's card, so drop a redundant room-name prefix
    // (e.g. "Claudias Room ceiling lights" -> "Ceiling lights", "Bedroom bed lights" -> "Bed lights").
    const room = areaName.trim();
    if (room && full.toLowerCase().startsWith(room.toLowerCase())) {
      const stripped = full
        .slice(room.length)
        .replace(/^[\s-]+/, '')
        .trim();
      if (stripped) return stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
    return full;
  };

  const getBrightness = (lightId: string) => {
    const entity = entities[lightId];
    if (entity?.state !== 'on') return 0;
    const brightness = attrNum(entity?.attributes?.brightness, 255);
    return brightness > 0 ? Math.round((brightness / 255) * 100) : 100;
  };

  /** The light's CURRENT color: reported RGB first, then its white temperature, then plain amber. */
  const getLightColor = (lightId: string): string => {
    const entity = entities[lightId];
    const rawRgb = entity?.attributes?.rgb_color;
    if (Array.isArray(rawRgb) && rawRgb.length === 3) {
      const rgb = rawRgb.map(c => attrNum(c, 0)) as [number, number, number];
      return rgbToHex(rgb);
    }
    const kelvinRaw = entity?.attributes?.color_temp_kelvin;
    if (kelvinRaw != null) {
      const kelvin = attrNum(kelvinRaw, NaN);
      if (Number.isFinite(kelvin) && kelvin > 0) return kelvinToHex(kelvin);
    }
    return DEFAULT_ON_COLOR;
  };

  // Initialize slider values when expanded
  useEffect(() => {
    if (!collapsed) {
      availableLights.forEach(lightId => {
        const entity = entities[lightId];
        const entityBrightness =
          entity?.state === 'on'
            ? attrNum(entity?.attributes?.brightness, 255) > 0
              ? Math.round((attrNum(entity.attributes.brightness, 255) / 255) * 100)
              : 100
            : 0;

        setSliderValues(prev => {
          // Initialize if not set
          if (prev[lightId] === undefined) {
            return { ...prev, [lightId]: entityBrightness };
          }
          return prev;
        });
      });
    }
  }, [collapsed, availableLights, entities]);

  // Clear optimistic state when entity state matches
  useEffect(() => {
    availableLights.forEach(lightId => {
      const optimisticState = optimisticStates[lightId];
      if (optimisticState !== null && optimisticState !== undefined) {
        const entityState = entities[lightId]?.state;
        if (entityState === optimisticState) {
          // Entity state matches optimistic state - clear it
          setOptimisticStates(prev => {
            const next = { ...prev };
            delete next[lightId];
            return next;
          });
        }
      }
    });
  }, [entities, availableLights, optimisticStates]);

  // Sync slider values with entity brightness when not actively dragging
  // But keep local value for a short time after commit to prevent UI flicker
  useEffect(() => {
    availableLights.forEach(lightId => {
      if (!dragging[lightId]) {
        const entity = entities[lightId];
        const entityBrightness =
          entity?.state === 'on'
            ? attrNum(entity?.attributes?.brightness, 255) > 0
              ? Math.round((attrNum(entity.attributes.brightness, 255) / 255) * 100)
              : 100
            : 0;

        const lastCommitted = lastCommittedRef.current[lightId];
        const timeSinceCommit = lastCommitted ? Date.now() - lastCommitted.timestamp : Infinity;
        const currentSliderValue = sliderValues[lightId];

        // Don't sync if we have a recent commit (within 2 seconds)
        // This prevents the UI from jumping back to old values
        if (lastCommitted && timeSinceCommit < 2000) {
          // Only sync if entity matches what we committed (within 2% tolerance)
          const matchesCommitted = Math.abs(entityBrightness - lastCommitted.value) <= 2;
          if (matchesCommitted) {
            // Entity confirmed our change - clear the ref
            delete lastCommittedRef.current[lightId];
            // Update slider if needed (should already match, but ensure consistency)
            if (currentSliderValue !== entityBrightness) {
              setSliderValues(prev => ({ ...prev, [lightId]: entityBrightness }));
            }
          }
          // Otherwise, keep our committed value - don't sync
          return;
        }

        // No recent commit or commit is old - safe to sync
        // Only update if slider value differs from entity (avoid unnecessary updates)
        if (currentSliderValue !== entityBrightness) {
          setSliderValues(prev => ({ ...prev, [lightId]: entityBrightness }));
        }
      }
    });
  }, [entities, availableLights, dragging, sliderValues]);

  if (availableLights.length === 0) return null;

  return (
    <div className='light-card'>
      {/* Top row - also the collapse/expand tap target */}
      <div
        className='light-top'
        onClick={() => {
          if (lightHeaderSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={lightHeaderSlop.onTouchStart}
        onTouchMove={lightHeaderSlop.onTouchMove}
        onTouchEnd={lightHeaderSlop.onTouchEnd}
        onTouchCancel={lightHeaderSlop.onTouchCancel}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed(v => !v);
          }
        }}
      >
        <span className={`light-glyph ${someOn ? '' : 'is-off'}`}>
          <Icon icon='mdi:lightbulb-on-outline' aria-hidden='true' />
        </span>
        <span className='light-title'>Lights</span>
        <span className='light-top-right'>
          {/* Quick dots (user 2026-07-31, same idea as the Access card's doors): every light
              is one tap from the collapsed row, each wearing its own current color. The dots
              also ARE the "n of m on" count, so the word is gone - lit dots say it better. */}
          <span
            className='light-quick'
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            role='presentation'
          >
            {availableLights.map(lightId => {
              const optimisticState = optimisticStates[lightId];
              const isOn =
                optimisticState !== null && optimisticState !== undefined
                  ? optimisticState === 'on'
                  : entities[lightId]?.state === 'on';
              const name = getLightName(lightId);
              return (
                <button
                  key={lightId}
                  type='button'
                  className={`light-quick-dot ${isOn ? '' : 'is-off'}`}
                  style={isOn ? { background: getLightColor(lightId) } : undefined}
                  onClick={() => handleToggleLight(lightId)}
                  aria-label={`${isOn ? 'Turn off' : 'Turn on'} ${name}`}
                  title={name}
                />
              );
            })}
          </span>
          {overrideOn && (
            <span className='light-override-header-icon' title='Automatic lighting is paused for this room'>
              <Icon icon='mdi:hand-back-right' aria-hidden='true' />
            </span>
          )}
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='light-chevron' />
        </span>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div className='light-rows'>
          {availableLights.map(lightId => {
            // Use optimistic state if available, otherwise use entity state
            const optimisticState = optimisticStates[lightId];
            const isOn =
              optimisticState !== null && optimisticState !== undefined ? optimisticState === 'on' : entities[lightId]?.state === 'on';
            const brightness = getBrightness(lightId);
            const supportedColorModes = entities[lightId]?.attributes?.supported_color_modes || [];
            const supportsBrightness = Array.isArray(supportedColorModes)
              ? supportedColorModes.some((mode: string) => mode !== 'onoff')
              : false;

            const supportsColorMode = supportsColor(lightId);
            const value = sliderValues[lightId] ?? brightness;
            const color = getLightColor(lightId);

            return (
              <div key={lightId} className={`light-row ${isOn ? 'is-on' : ''}`}>
                <button
                  type='button'
                  className={`light-dot ${isOn ? '' : 'is-off'}`}
                  style={isOn ? { background: color, color: isLightColor(color) ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)' } : undefined}
                  onClick={e => handleDotClick(lightId, e)}
                  aria-label={supportsColorMode ? `Pick a color for ${getLightName(lightId)}` : `Toggle ${getLightName(lightId)}`}
                  title={supportsColorMode ? 'Color' : 'Toggle'}
                >
                  <Icon icon='mdi:lightbulb' aria-hidden='true' />
                </button>

                <button type='button' className='light-name' onClick={() => handleToggleLight(lightId)}>
                  {getLightName(lightId)}
                </button>

                {supportsBrightness ? (
                  <>
                    <div className='light-strip'>
                      <div
                        className='light-strip-fill'
                        style={{ width: `${value}%`, background: `linear-gradient(90deg, ${darken(color, 0.45)}, ${color})` }}
                      />
                      <input
                        type='range'
                        min='0'
                        max='100'
                        value={value}
                        aria-label={`${getLightName(lightId)} brightness`}
                        onChange={e => {
                          const val = parseInt(e.target.value);
                          setSliderValues(prev => ({ ...prev, [lightId]: val }));
                          setDragging(prev => ({ ...prev, [lightId]: true }));
                        }}
                        onInput={e => {
                          // iOS Safari needs onInput for real-time updates while dragging
                          const val = parseInt((e.target as HTMLInputElement).value);
                          setSliderValues(prev => ({ ...prev, [lightId]: val }));
                          setDragging(prev => ({ ...prev, [lightId]: true }));
                        }}
                        onMouseUp={() => {
                          const val = sliderValues[lightId] ?? brightness;
                          handleBrightnessCommit(lightId, val);
                          setDragging(prev => ({ ...prev, [lightId]: false }));
                        }}
                        onTouchStart={e => {
                          // Stop propagation to prevent parent swipe handlers from interfering
                          // Don't preventDefault - we need native slider dragging in HA app WebView
                          e.stopPropagation();
                        }}
                        onTouchMove={e => {
                          // Stop propagation to prevent parent swipe handlers from interfering
                          // Don't preventDefault - we need native slider dragging in HA app WebView
                          e.stopPropagation();
                        }}
                        onTouchEnd={e => {
                          e.stopPropagation();
                          const val = sliderValues[lightId] ?? brightness;
                          handleBrightnessCommit(lightId, val);
                          setDragging(prev => ({ ...prev, [lightId]: false }));
                        }}
                        className='light-strip-input'
                      />
                    </div>
                    <span className='light-value'>{value > 0 ? `${value}%` : 'off'}</span>
                  </>
                ) : (
                  <span className='light-value'>{isOn ? 'on' : 'off'}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Color sheet */}
      {colorPickerLightId &&
        (() => {
          const lightEntity = entities[colorPickerLightId];
          const supportedColorModes = attrStringArray(lightEntity?.attributes?.supported_color_modes);
          const modalSupportsRgb =
            supportedColorModes.includes('rgb') || supportedColorModes.includes('hs') || supportedColorModes.includes('xy');
          const modalSupportsColorTemp = supportedColorModes.includes('color_temp');
          const rawRgb = lightEntity?.attributes?.rgb_color;
          const currentRgb: [number, number, number] | undefined =
            Array.isArray(rawRgb) && rawRgb.length === 3 ? (rawRgb as [number, number, number]) : undefined;
          const currentColorTemp =
            lightEntity?.attributes?.color_temp_kelvin != null ? attrNum(lightEntity.attributes.color_temp_kelvin, 0) : undefined;

          return (
            <ColorPickerModal
              lightId={colorPickerLightId}
              lightName={getLightName(colorPickerLightId)}
              supportsRgb={modalSupportsRgb}
              supportsColorTemp={modalSupportsColorTemp}
              currentRgb={currentRgb}
              currentColorTemp={currentColorTemp}
              onColorSelect={rgb => handleColorSelect(colorPickerLightId, rgb)}
              onColorTempSelect={kelvin => handleColorTempSelect(colorPickerLightId, kelvin)}
              onClose={() => setColorPickerLightId(null)}
            />
          );
        })()}
    </div>
  );
}

// Color sheet - same tabs, same presets, same swatches and selection tolerances as before;
// only the chrome moved into the card language.
interface ColorPickerModalProps {
  lightId: string;
  lightName: string;
  supportsRgb: boolean;
  supportsColorTemp: boolean;
  currentRgb?: [number, number, number];
  currentColorTemp?: number;
  onColorSelect: (rgb: [number, number, number]) => void;
  onColorTempSelect: (kelvin: number) => void;
  onClose: () => void;
}

function ColorPickerModal({
  lightName,
  supportsRgb,
  supportsColorTemp,
  currentRgb,
  currentColorTemp,
  onColorSelect,
  onColorTempSelect,
  onClose,
}: ColorPickerModalProps) {
  const [selectedTab, setSelectedTab] = useState<'colors' | 'temp'>(supportsColorTemp ? 'temp' : 'colors');
  const { requestClose } = useModalBackButton({
    isOpen: true,
    onRequestClose: onClose,
    historyKey: 'light-color-picker',
  });

  // Use standardized swipe-to-close hook
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);

  // Predefined color palette
  const colorPalette: Array<{ name: string; rgb: [number, number, number] }> = [
    { name: 'White', rgb: [255, 255, 255] },
    { name: 'Warm White', rgb: [255, 244, 229] },
    { name: 'Teal', rgb: [0, 128, 128] },
    { name: 'Red', rgb: [255, 0, 0] },
    { name: 'Orange', rgb: [255, 165, 0] },
    { name: 'Yellow', rgb: [255, 255, 0] },
    { name: 'Green', rgb: [0, 255, 0] },
    { name: 'Cyan', rgb: [0, 255, 255] },
    { name: 'Blue', rgb: [0, 0, 255] },
    { name: 'Purple', rgb: [128, 0, 128] },
    { name: 'Pink', rgb: [255, 192, 203] },
    { name: 'Magenta', rgb: [255, 0, 255] },
  ];

  // Color temperature presets (in Kelvin)
  const colorTempPresets = [
    { name: 'Warm', kelvin: 2700 },
    { name: 'Soft', kelvin: 3000 },
    { name: 'Neutral', kelvin: 4000 },
    { name: 'Cool', kelvin: 5000 },
    { name: 'Daylight', kelvin: 6500 },
  ];

  return (
    <div className='color-picker-overlay' onClick={requestClose}>
      <div
        className='color-picker-modal'
        role='dialog'
        aria-modal='true'
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='color-picker-header'>
          <span className='light-glyph'>
            <Icon icon='mdi:lightbulb-on-outline' aria-hidden='true' />
          </span>
          <h3>{lightName}</h3>
          <button className='color-picker-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>

        {supportsRgb && supportsColorTemp && (
          <div className='color-picker-tabs'>
            <button className={`color-picker-tab ${selectedTab === 'temp' ? 'active' : ''}`} onClick={() => setSelectedTab('temp')}>
              Temperature
            </button>
            <button className={`color-picker-tab ${selectedTab === 'colors' ? 'active' : ''}`} onClick={() => setSelectedTab('colors')}>
              Colors
            </button>
          </div>
        )}

        <div className='color-picker-content'>
          {selectedTab === 'colors' && supportsRgb && (
            <div className='color-palette'>
              {colorPalette.map((color, index) => {
                const rgbString = `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`;
                const isSelected =
                  currentRgb &&
                  Math.abs(currentRgb[0] - color.rgb[0]) < 10 &&
                  Math.abs(currentRgb[1] - color.rgb[1]) < 10 &&
                  Math.abs(currentRgb[2] - color.rgb[2]) < 10;

                return (
                  <button
                    key={index}
                    className={`color-swatch ${isSelected ? 'selected' : ''}`}
                    style={{ backgroundColor: rgbString }}
                    onClick={() => onColorSelect(color.rgb)}
                    title={color.name}
                    aria-label={color.name}
                  />
                );
              })}
            </div>
          )}

          {selectedTab === 'temp' && supportsColorTemp && (
            <div className='color-temp-presets'>
              {colorTempPresets.map((preset, index) => {
                const isSelected = currentColorTemp && Math.abs(currentColorTemp - preset.kelvin) < 100;
                return (
                  <button
                    key={index}
                    className={`color-temp-preset ${isSelected ? 'selected' : ''}`}
                    style={{ background: kelvinToHex(preset.kelvin) }}
                    onClick={() => onColorTempSelect(preset.kelvin)}
                    title={preset.name}
                    aria-label={`${preset.name}, ${preset.kelvin} kelvin`}
                  >
                    <span>{preset.kelvin}K</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
