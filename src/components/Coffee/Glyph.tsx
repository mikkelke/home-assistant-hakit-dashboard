/** Line glyphs the icon set has no match for: the machine's grinder, brewer and cup stages, the beans jar and the
 * hold hand. Drawn in `currentColor` at 1 em. */
const PATHS = {
  grinder: ['M6 4h12l-2 7H8z', 'M9 11v9h6v-9', 'M12 15h3'],
  brewer: ['M5 5h14l-3 8H8z', 'M12 13v7M9 20h6'],
  cup: ['M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z', 'M16 10h1.5a2 2 0 0 1 0 4H16', 'M5 21h12'],
  jar: ['M7 3h10v3H7z', 'M6 6h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z', 'M6 12h12'],
  hand: [
    'M9 11V5a1.5 1.5 0 0 1 3 0v5',
    'M12 10V4a1.5 1.5 0 0 1 3 0v6',
    'M15 10V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.3 15a1.5 1.5 0 0 1 2.4-1.8L9 16V11',
  ],
  bean: [
    'M12 4.5c-4 1.2-6.6 5.5-5.9 9.7.6 3.6 3.6 5.6 6.7 4.8 4-1.2 6.6-5.5 5.9-9.7-.6-3.6-3.6-5.6-6.7-4.8z',
    'M9.5 6.5c2.5 2.5 2.5 8.5 5 11',
  ],
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, className = '' }: { name: GlyphName; className?: string }) {
  return (
    <svg className={`coffee-glyph ${className}`} viewBox='0 0 24 24' aria-hidden='true'>
      {PATHS[name].map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
