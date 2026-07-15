/** da-DK number formatting for the Energy page. `Intl.NumberFormat` instances are expensive to
 * construct, so they're memoized at module scope rather than created per call. */
const numberFormatters = new Map<number, Intl.NumberFormat>();

function getNumberFormatter(decimals: number): Intl.NumberFormat {
  const cached = numberFormatters.get(decimals);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat('da-DK', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  numberFormatters.set(decimals, formatter);
  return formatter;
}

const twoDecimalFormatter = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** e.g. `formatKWh(12.4)` → `"12,4 kWh"` */
export function formatKWh(value: number, decimals = 1): string {
  return `${getNumberFormatter(decimals).format(value)} kWh`;
}

/** e.g. `formatKr(12.73)` → `"12,73 kr"` */
export function formatKr(value: number): string {
  return `${twoDecimalFormatter.format(value)} kr`;
}

/** e.g. `formatPrice(1.04)` → `"1,04 kr/kWh"` */
export function formatPrice(value: number): string {
  return `${twoDecimalFormatter.format(value)} kr/kWh`;
}

/** e.g. `formatW(234)` → `"234 W"`, `formatW(1234)` → `"1.234 W"` */
export function formatW(value: number): string {
  return `${getNumberFormatter(0).format(value)} W`;
}

/** e.g. `hourRangeLabel(<14:00 ms>)` → `"14:00–15:00"` (ms-arg Date construction is render-pure). */
export function hourRangeLabel(ms: number): string {
  const startHour = new Date(ms).getHours();
  const endHour = (startHour + 1) % 24;
  return `${String(startHour).padStart(2, '0')}:00–${String(endHour).padStart(2, '0')}:00`;
}
