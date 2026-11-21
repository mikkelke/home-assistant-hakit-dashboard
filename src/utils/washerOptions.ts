/** Programmes the Miele WEA 035 offers Kort (a shorter wash) for, as named in washer_programmes.yaml.
 * Ekspres 20 has it built in and has no switch; ECO, Uld, Imprægnering and Kun skyl/stivelse do not offer it. */
const KORT_PROGRAMMES = new Set(['Bomuld', 'Strygelet', 'Finvask', 'Mørkt/Denim', 'Outdoor']);

export function washerSupportsShort(programmeLabel: string | undefined | null): boolean {
  return programmeLabel != null && KORT_PROGRAMMES.has(programmeLabel);
}
