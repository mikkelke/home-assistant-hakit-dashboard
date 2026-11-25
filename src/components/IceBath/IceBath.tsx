import './IceBath.css';

/** The water line and the frost of an ice bath surface: the chip in the weather sheet and the hero on the terrace. The
 * surface carries the `ice-skin` class, sets `--frost` (0 warm to 1 freezing) and `data-ice` while ice is likely; its
 * content is drawn above these two layers. */
export function IceLayers() {
  return (
    <>
      <span className='ice-water' aria-hidden='true'>
        <span className='ice-wave' />
      </span>
      <span className='ice-frost' aria-hidden='true' />
    </>
  );
}

/** A snowflake the size of the text it sits in front of. */
export function IceFlake() {
  return (
    <svg
      className='ice-flake'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2.2'
      strokeLinecap='round'
      aria-hidden='true'
    >
      <path d='M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M12 5l-2.5-2M12 5l2.5-2M12 19l-2.5 2M12 19l2.5 2' />
    </svg>
  );
}
