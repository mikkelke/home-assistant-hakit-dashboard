import { useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStringArray, attrStr } from '../../types';
import { useSwipeToClose } from '../../hooks';
import './LightCard.css';
import { ROOM_LIGHTS } from '../../config/lights';

interface LightCardProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function LightCard({ areaName, entities, callService }: LightCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});
  const [showBubbles, setShowBubbles] = useState<Record<string, boolean>>({});
  const [colorPickerLightId, setColorPickerLightId] = useState<string | null>(null);
  // Optimistic state for immediate UI feedback
  const [optimisticStates, setOptimisticStates] = useState<Record<string, 'on' | 'off' | null>>({});
  // Track last committed values and timestamps to prevent UI flicker
  const lastCommittedRef = useRef<Record<string, { value: number; timestamp: number }>>({});

  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');
  const roomLights = ROOM_LIGHTS[areaNameNormalized] || [];

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

  // Handle color picker button click
  const handleColorPickerClick = useCallback(
    (lightId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (supportsColor(lightId)) {
        setColorPickerLightId(lightId);
      }
    },
    [supportsColor]
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
    return attrStr(entity?.attributes?.friendly_name) || lightId.split('.')[1].replace(/_/g, ' ');
  };

  const getBrightness = (lightId: string) => {
    const entity = entities[lightId];
    if (entity?.state !== 'on') return 0;
    const brightness = attrNum(entity?.attributes?.brightness, 255);
    return brightness > 0 ? Math.round((brightness / 255) * 100) : 100;
  };

  // Initialize slider values when expanded
  useEffect(() => {
    if (isExpanded) {
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
  }, [isExpanded, availableLights, entities]);

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
      if (!showBubbles[lightId]) {
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
  }, [entities, availableLights, showBubbles, sliderValues]);

  if (availableLights.length === 0) return null;

  return (
    <div className={`light-card ${isExpanded ? 'expanded' : ''}`}>
      {/* Header (use div to avoid nested buttons) */}
      <div
        className='light-header'
        onClick={() => setIsExpanded(!isExpanded)}
        role='button'
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div className='light-header-info'>
          <Icon icon={someOn ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline'} className={`light-icon ${someOn ? 'on' : ''}`} />
          <div className='light-status'>
            <span className='light-title'>Lights</span>
            <span className='light-count'>
              {lightsOn} of {availableLights.length} on
            </span>
          </div>
        </div>
        <div className='light-header-right'>
          <Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className='light-content'>
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

            return (
              <div key={lightId} className={`light-item ${isOn ? 'on' : ''}`}>
                <div className='light-item-header'>
                  <button className='light-item-toggle' onClick={() => handleToggleLight(lightId)}>
                    <Icon icon={isOn ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline'} className={`light-item-icon ${isOn ? 'on' : ''}`} />
                    <span className='light-item-name'>{getLightName(lightId)}</span>
                  </button>
                  {supportsColorMode && (
                    <button className='light-color-btn' onClick={e => handleColorPickerClick(lightId, e)} title='Select color'>
                      <Icon icon='mdi:palette' />
                    </button>
                  )}
                </div>

                {supportsBrightness && (
                  <div className='light-brightness'>
                    <div className={`slider-with-bubble ${showBubbles[lightId] ? 'show-bubble' : ''}`}>
                      <input
                        type='range'
                        min='0'
                        max='100'
                        value={sliderValues[lightId] ?? brightness}
                        onChange={e => {
                          const val = parseInt(e.target.value);
                          setSliderValues(prev => ({ ...prev, [lightId]: val }));
                          setShowBubbles(prev => ({ ...prev, [lightId]: true }));
                        }}
                        onInput={e => {
                          // iOS Safari needs onInput for real-time updates while dragging
                          const val = parseInt((e.target as HTMLInputElement).value);
                          setSliderValues(prev => ({ ...prev, [lightId]: val }));
                          setShowBubbles(prev => ({ ...prev, [lightId]: true }));
                        }}
                        onMouseUp={() => {
                          const val = sliderValues[lightId] ?? brightness;
                          handleBrightnessCommit(lightId, val);
                          setShowBubbles(prev => ({ ...prev, [lightId]: false }));
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
                          setShowBubbles(prev => ({ ...prev, [lightId]: false }));
                        }}
                        className='brightness-slider'
                      />
                      <div className='slider-value-bubble' style={{ left: `${sliderValues[lightId] ?? brightness}%` }}>
                        {sliderValues[lightId] ?? brightness}%
                      </div>
                    </div>
                    <span className='brightness-value'>{sliderValues[lightId] ?? brightness}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Color Picker Modal */}
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

// Color Picker Modal Component
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

  // Use standardized swipe-to-close hook
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(onClose);

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
    <div className='color-picker-overlay' onClick={onClose}>
      <div
        className='color-picker-modal'
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='color-picker-header'>
          <h3>{lightName}</h3>
          <button className='color-picker-close modal-close-button' onClick={onClose}>
            <Icon icon='mdi:close' />
          </button>
        </div>

        {supportsRgb && supportsColorTemp && (
          <div className='color-picker-tabs'>
            <button className={`color-picker-tab ${selectedTab === 'temp' ? 'active' : ''}`} onClick={() => setSelectedTab('temp')}>
              <Icon icon='mdi:thermometer' />
              <span>Temperature</span>
            </button>
            <button className={`color-picker-tab ${selectedTab === 'colors' ? 'active' : ''}`} onClick={() => setSelectedTab('colors')}>
              <Icon icon='mdi:palette' />
              <span>Colors</span>
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
                  >
                    {isSelected && <Icon icon='mdi:check' />}
                  </button>
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
                    onClick={() => onColorTempSelect(preset.kelvin)}
                  >
                    <div className='color-temp-indicator' style={{ backgroundColor: getColorTempColor(preset.kelvin) }} />
                    <span>{preset.name}</span>
                    {isSelected && <Icon icon='mdi:check' />}
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

// Helper to get color for color temperature (approximate)
function getColorTempColor(kelvin: number): string {
  if (kelvin <= 2700) return 'rgb(255, 180, 107)'; // Warm
  if (kelvin <= 3000) return 'rgb(255, 196, 137)'; // Soft
  if (kelvin <= 4000) return 'rgb(255, 228, 206)'; // Neutral
  if (kelvin <= 5000) return 'rgb(255, 249, 253)'; // Cool
  return 'rgb(201, 226, 255)'; // Daylight
}
