import { useState } from 'react';
import { useEnergyDevices, useEnergyView, type DeviceUsage, type Period } from '../../energy';
import { rangeFor } from '../../energy/period';
import { DeviceBreakdown } from './DeviceBreakdown';
import { DeviceDialog } from './DeviceDialog';
import { PeriodPicker } from './PeriodPicker';

interface DevicesTabProps {
  period: Period;
  anchorStartMs: number;
  todayStartMs: number;
  nextStepDisabled: boolean;
  onPeriodChange: (period: Period) => void;
  onStep: (delta: 1 | -1) => void;
}

/** Tab "Devices": period picker plus the per-device breakdown. Owns `selectedDevice` locally (opens
 * DeviceDialog) — a tab-local selection, reset on every period/step change and (by unmounting) on
 * tab switch. `useEnergyView` here is the breakdown's cost basis only (device cost is always
 * derived against the period's bars — see `deviceCostApprox`); its own bars/chart aren't rendered. */
export function DevicesTab({ period, anchorStartMs, todayStartMs, nextStepDisabled, onPeriodChange, onStep }: DevicesTabProps) {
  const [selectedDevice, setSelectedDevice] = useState<DeviceUsage | null>(null);
  const { data, forceReload: viewForceReload } = useEnergyView(period, anchorStartMs);
  const devicesState = useEnergyDevices(period, anchorStartMs, data);

  const handlePeriodChange = (nextPeriod: Period) => {
    onPeriodChange(nextPeriod);
    setSelectedDevice(null);
  };

  const handleStep = (delta: 1 | -1) => {
    onStep(delta);
    setSelectedDevice(null);
  };

  // Force-refresh (PeriodPicker long-press): busts both hooks' persisted cache for the current
  // period and reloads, bypassing their own reload-coalescing guard.
  const handleForceReload = () => {
    viewForceReload();
    devicesState.forceReload();
  };

  return (
    <>
      <PeriodPicker
        period={period}
        anchorStartMs={anchorStartMs}
        todayStartMs={todayStartMs}
        onPeriodChange={handlePeriodChange}
        onStep={handleStep}
        nextStepDisabled={nextStepDisabled}
        onForceReload={handleForceReload}
      />

      {data && (
        <DeviceBreakdown
          period={period}
          view={data}
          devices={devicesState.data}
          loading={devicesState.loading}
          refreshing={devicesState.refreshing}
          error={devicesState.error}
          onReload={devicesState.reload}
          onSelectDevice={setSelectedDevice}
        />
      )}

      {selectedDevice && (
        <DeviceDialog
          device={selectedDevice}
          period={period}
          anchorStartMs={anchorStartMs}
          rangeEndMs={rangeFor(period, anchorStartMs).endMs}
          onClose={() => setSelectedDevice(null)}
        />
      )}
    </>
  );
}
