import { useMemo } from 'react';
import { assembleBill, type EnergyView } from '../../energy';
import { formatKr } from '../../utils/format';
import './BillCard.css';

interface BillCardProps {
  view: EnergyView;
  nowMs: number;
}

/** Card "Bill": the visible period's bill — exact variable cost (HA's own cost stat) plus the
 * period's full share of the fixed subscription fees. The in-progress period additionally shows a
 * "Projected ≈" projection (see `assembleBill`); a past, fully-settled period shows only the
 * settled total, which is what reconciles with the actual Vindstød invoice. Renders the same way
 * for every view — day, week, month, year — against that view's own period totals. */
export function BillCard({ view, nowMs }: BillCardProps) {
  const bill = useMemo(() => assembleBill(view, nowMs), [view, nowMs]);

  return (
    <div className='bill-card'>
      <div className='bill-card-header'>
        <h2>Bill</h2>
      </div>

      <div className='bill-card-rows'>
        <div className='bill-card-row'>
          <span className='bill-card-row-label'>Consumption</span>
          <span className='bill-card-row-value'>{formatKr(bill.variableKr)}</span>
        </div>

        <div className='bill-card-row-group'>
          <div className='bill-card-row'>
            <span className='bill-card-row-label'>Subscription</span>
            <span className='bill-card-row-value'>{formatKr(bill.feesKr)}</span>
          </div>
          <p className='bill-card-note'>Radius net + Energinet TSO, incl. VAT</p>
        </div>

        <div className='bill-card-divider' />

        <div className='bill-card-row bill-card-row--total'>
          <span className='bill-card-row-label'>Total</span>
          <span className='bill-card-row-value'>{formatKr(bill.totalKr)}</span>
        </div>

        {bill.projectedTotalKr != null && (
          <div className='bill-card-row-group'>
            <div className='bill-card-row'>
              <span className='bill-card-row-label'>Projected</span>
              <span className='bill-card-row-value'>≈ {formatKr(bill.projectedTotalKr)}</span>
            </div>
            <p className='bill-card-note'>extrapolated from usage so far</p>
          </div>
        )}
      </div>

      <p className='bill-card-footnote'>Estimate — settled by the supplier (±4 %)</p>
    </div>
  );
}
