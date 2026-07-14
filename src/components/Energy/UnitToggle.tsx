import './UnitToggle.css';

interface UnitToggleProps {
  unit: 'kwh' | 'kr';
  onChange: (unit: 'kwh' | 'kr') => void;
}

const UNIT_OPTIONS: Array<{ value: 'kwh' | 'kr'; label: string }> = [
  { value: 'kwh', label: 'kWh' },
  { value: 'kr', label: 'kr' },
];

export function UnitToggle({ unit, onChange }: UnitToggleProps) {
  return (
    <div className='unit-toggle'>
      {UNIT_OPTIONS.map(option => (
        <button
          key={option.value}
          type='button'
          className={`unit-toggle-btn ${unit === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
