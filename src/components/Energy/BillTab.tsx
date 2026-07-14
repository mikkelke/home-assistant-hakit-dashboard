import { useEnergyView, type Period } from '../../energy';
import { BillCard } from './BillCard';
import { PeriodPicker } from './PeriodPicker';

interface BillTabProps {
  period: Period;
  anchorStartMs: number;
  todayStartMs: number;
  nextStepDisabled: boolean;
  onPeriodChange: (period: Period) => void;
  onStep: (delta: 1 | -1) => void;
  nowMs: number;
}

/** Tab "Bill": period picker plus the settled/projected bill for the visible period. No tab-local
 * selection state — BillCard has nothing to select. */
export function BillTab({ period, anchorStartMs, todayStartMs, nextStepDisabled, onPeriodChange, onStep, nowMs }: BillTabProps) {
  const { data, forceReload } = useEnergyView(period, anchorStartMs);

  return (
    <>
      <PeriodPicker
        period={period}
        anchorStartMs={anchorStartMs}
        todayStartMs={todayStartMs}
        onPeriodChange={onPeriodChange}
        onStep={onStep}
        nextStepDisabled={nextStepDisabled}
        onForceReload={forceReload}
      />

      {data && <BillCard view={data} nowMs={nowMs} />}
    </>
  );
}
