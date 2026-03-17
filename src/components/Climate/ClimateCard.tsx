import { useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStringArray, attrStr } from '../../types';
import './ClimateCard.css';

interface ClimateCardProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function ClimateCard({ areaName, entities, callService }: ClimateCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');

  // Entity IDs
  const thermostatId = `climate.${areaNameNormalized}_thermostat`;
  const floorTempId = `sensor.${areaNameNormalized}_floor_thermometer_temperature`;

  const thermostat = entities?.[thermostatId];
  const floorTemp = entities?.[floorTempId];

  const currentTemp = attrNum(thermostat?.attributes?.current_temperature, NaN);
  const targetTemp = attrNum(thermostat?.attributes?.temperature, NaN);
  const minTemp = attrNum(thermostat?.attributes?.min_temp, 15);
  const maxTemp = attrNum(thermostat?.attributes?.max_temp, 30);
  const hvacMode = attrStr(thermostat?.state, 'off'); // auto, heat, off
  const hvacAction = attrStr(thermostat?.attributes?.hvac_action); // heating, idle, off, etc.
  const presetModes: string[] = attrStringArray(thermostat?.attributes?.preset_modes);
  const presetMode = attrStr(thermostat?.attributes?.preset_mode);

  const [localPreset, setLocalPreset] = useState<string | null>(null);
  const [targetInput, setTargetInput] = useState<number>(Number.isFinite(targetTemp) ? targetTemp : minTemp);
  const [showTargetBubble, setShowTargetBubble] = useState(false);
  // Track last committed value to prevent UI flicker
  const lastCommittedRef = useRef<{ value: number; timestamp: number } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setLocalPreset(null), 0);
    return () => clearTimeout(id);
  }, [presetMode]);

  useEffect(() => {
    // Don't sync while user is actively dragging
    if (showTargetBubble) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (Number.isFinite(targetTemp)) {
      const lastCommitted = lastCommittedRef.current;
      const timeSinceCommit = lastCommitted ? Date.now() - lastCommitted.timestamp : Infinity;

      // Don't sync if we have a recent commit (within 2 seconds)
      if (lastCommitted && timeSinceCommit < 2000) {
        const matchesCommitted = Math.abs(targetTemp - lastCommitted.value) < 0.2;
        if (matchesCommitted) {
          lastCommittedRef.current = null;
          if (Math.abs(targetInput - targetTemp) > 0.1) {
            timeoutId = setTimeout(() => setTargetInput(targetTemp), 0);
          }
        }
      } else if (Math.abs(targetInput - targetTemp) > 0.1) {
        timeoutId = setTimeout(() => setTargetInput(targetTemp), 0);
      }
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [targetTemp, showTargetBubble, targetInput]);

  const handleTargetCommit = useCallback(
    (newTarget: number) => {
      if (!callService) return;
      // Update local state immediately to prevent UI jump
      setTargetInput(newTarget);
      // Track the committed value to prevent UI flicker
      lastCommittedRef.current = { value: newTarget, timestamp: Date.now() };
      callService({
        domain: 'climate',
        service: 'set_temperature',
        target: { entity_id: thermostatId },
        serviceData: { temperature: newTarget },
      });
    },
    [callService, thermostatId]
  );

  const handlePresetChange = useCallback(
    (preset: string) => {
      if (!callService) {
        console.warn('ClimateCard: callService is undefined');
        return;
      }
      setLocalPreset(preset); // optimistic
      callService({
        domain: 'climate',
        service: 'set_preset_mode',
        target: { entity_id: thermostatId },
        serviceData: { preset_mode: preset },
      });
    },
    [callService, thermostatId]
  );

  if (!thermostat) return null;

  const displayPreset = localPreset ?? presetMode;

  const isAtTarget = Number.isFinite(currentTemp) && Number.isFinite(targetTemp) ? Math.abs(currentTemp - targetTemp) < 0.2 : false;
  const isCoolingRequest =
    Number.isFinite(currentTemp) && Number.isFinite(targetTemp)
      ? targetTemp < currentTemp - 0.1 // if target is below current, we'd need cooling (which we don't have)
      : false;
  const targetStateClass = hvacAction === 'heating' ? 'heating' : isCoolingRequest ? 'cooling' : isAtTarget ? 'at-target' : '';

  const displayTarget = isExpanded ? targetInput : targetTemp;

  const getPresetIcon = (preset: string) => {
    const lower = preset.toLowerCase();
    if (lower.includes('follow')) return 'mdi:calendar-clock';
    if (lower.includes('schedule')) return 'mdi:calendar-clock';
    if (lower.includes('permanent') || lower.includes('hold')) return 'mdi:fire';
    if (lower === 'off') return 'mdi:power';
    return 'mdi:information-outline';
  };

  const formatPresetLabel = (preset: string) => {
    if (preset.toLowerCase() === 'off') return 'Off';
    if (preset.toLowerCase().includes('follow')) return 'Schedule';
    if (preset.toLowerCase().includes('hold')) return 'Heat';
    return preset;
  };

  const formatModeLabel = (mode: string) => {
    if (mode.toLowerCase() === 'auto') return 'Schedule';
    return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
  };

  return (
    <div className={`climate-card ${isExpanded ? 'expanded' : ''}`}>
      {/* Collapsed view - clickable header */}
      <button className='climate-header' onClick={() => setIsExpanded(!isExpanded)}>
        <div className='climate-header-info'>
          <Icon icon='mdi:thermostat' className='climate-icon' />
          <div className='climate-temps'>
            <span className='climate-current'>{Number.isFinite(currentTemp) ? currentTemp : '--'}°C</span>
            <Icon icon='mdi:arrow-right' className='climate-arrow' />
            <span className={`climate-target ${targetStateClass}`}>
              {Number.isFinite(displayTarget as number) ? displayTarget : '--'}°C
            </span>
          </div>
        </div>
        <div className='climate-header-right'>
          <span className={`climate-mode ${hvacMode}`}>{formatModeLabel(hvacMode)}</span>
          <Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </div>
      </button>

      {/* Expanded view */}
      {isExpanded && (
        <div className='climate-content'>
          {/* Temperature Display */}
          <div className='climate-display'>
            <div className='climate-display-item'>
              <Icon icon='mdi:home-thermometer' />
              <span className='display-value'>{Number.isFinite(currentTemp) ? currentTemp : '--'}°C</span>
              <span className='display-label'>Room</span>
            </div>
            <div className={`climate-display-item target ${targetStateClass}`}>
              <Icon icon='mdi:thermostat' />
              <span className='display-value'>{Number.isFinite(displayTarget as number) ? displayTarget : '--'}°C</span>
              <span className='display-label'>Target</span>
            </div>
            {floorTemp && (
              <div className='climate-display-item floor'>
                <Icon icon='mdi:heating-coil' />
                <span className='display-value'>{attrStr(floorTemp.state, '--')}°C</span>
                <span className='display-label'>Floor</span>
              </div>
            )}
          </div>

          {/* Temperature Slider */}
          <div className='climate-slider-container'>
            <span className='slider-min'>{minTemp}°</span>
            <input
              type='range'
              min={minTemp}
              max={maxTemp}
              step={0.5}
              value={targetInput}
              onChange={e => {
                setTargetInput(parseFloat(e.target.value));
                setShowTargetBubble(true);
              }}
              onInput={e => {
                // iOS Safari needs onInput for real-time updates while dragging
                setTargetInput(parseFloat((e.target as HTMLInputElement).value));
                setShowTargetBubble(true);
              }}
              onMouseUp={() => {
                handleTargetCommit(targetInput);
                setShowTargetBubble(false);
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
                handleTargetCommit(targetInput);
                setShowTargetBubble(false);
              }}
              className='climate-slider'
            />
            <div
              className={`slider-value-bubble ${showTargetBubble ? 'show' : ''}`}
              style={{
                left: `${((targetInput - minTemp) / (maxTemp - minTemp)) * 100}%`,
              }}
            >
              {targetInput.toFixed(1)}°
            </div>
            <span className='slider-max'>{maxTemp}°</span>
          </div>

          {/* Quick adjust buttons */}
          <div className='climate-quick-adjust'>
            <button
              type='button'
              className='adjust-btn'
              onClick={e => {
                e.stopPropagation();
                const next = (Number.isFinite(targetInput) ? targetInput : Number.isFinite(targetTemp) ? targetTemp : 20) - 0.5;
                setTargetInput(next);
                handleTargetCommit(next);
              }}
            >
              <Icon icon='mdi:minus' />
            </button>
            <span className='adjust-value'>{Number.isFinite(displayTarget as number) ? displayTarget : '--'}°C</span>
            <button
              type='button'
              className='adjust-btn'
              onClick={e => {
                e.stopPropagation();
                const next = (Number.isFinite(targetInput) ? targetInput : Number.isFinite(targetTemp) ? targetTemp : 20) + 0.5;
                setTargetInput(next);
                handleTargetCommit(next);
              }}
            >
              <Icon icon='mdi:plus' />
            </button>
          </div>

          {/* Preset Selector (e.g., Follow Schedule vs Hold) */}
          {presetModes.length > 0 && (
            <div className='climate-presets'>
              {presetModes.map(preset => (
                <button
                  key={preset}
                  type='button'
                  className={`preset-icon-btn ${displayPreset === preset ? 'active' : ''} ${localPreset === preset ? 'pending' : ''}`}
                  onClick={() => handlePresetChange(preset)}
                  title={preset}
                >
                  <Icon icon={getPresetIcon(preset)} />
                  <span>{formatPresetLabel(preset)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
