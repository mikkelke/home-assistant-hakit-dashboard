import { useId } from 'react';
import type { CookState } from '../../cook/model';
import { centred, degrees } from './view';

function needleColor(value: number | null): string {
  if (value == null) return 'var(--text-3)';
  return `hsl(${Math.max(22, Math.min(205, 205 - (value - 15) * 4.1))} 88% 72%)`;
}

export function Needle({ state }: { state: CookState }) {
  const gradient = useId();
  const { needle, coreIndex, ambient, phase } = state.probe;
  const locked = phase === 'resting' || phase === 'carve';
  const description = `One needle, tip to handle: ${needle.map(degrees).join(', ')}. Handle ${degrees(ambient)}.${coreIndex != null ? ` Core at point ${coreIndex + 1}${locked ? ', held since pull' : ''}.` : ''}`;
  return (
    <svg className='cook-needle' viewBox='0 0 340 64' role='img' aria-label={description}>
      <defs>
        <linearGradient id={gradient} x1='0' x2='1'>
          {[0, 1, 2, 3].map(index => (
            <stop key={index} offset={index / 3} stopColor={needleColor(needle[index] ?? null)} />
          ))}
        </linearGradient>
      </defs>
      <rect x='2' y='8' width='226' height='48' rx='16' className='cook-needle-meat' />
      <path d='M8 32 L26 26.5 H252 V37.5 H26 Z' fill={`url(#${gradient})`} />
      {coreIndex != null && (
        <circle cx={30 + coreIndex * 61} cy='32' r='10' className={`cook-needle-ring ${centred(state) ? 'is-centred' : ''}`} />
      )}
      <rect x='252' y='19' width='84' height='26' rx='9' className='cook-needle-handle' />
      <text x='294' y='37' textAnchor='middle' className='cook-needle-value'>
        {ambient == null ? '—' : `${Math.round(ambient)}°`}
      </text>
    </svg>
  );
}
