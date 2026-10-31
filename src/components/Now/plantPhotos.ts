/** The photos of the houseplants: the files in `plantPhotos/`, each named by the key a plant's `photo` carries. */
const photos = import.meta.glob<string>('./plantPhotos/*.webp', { eager: true, query: '?url', import: 'default' });

const byKey = new Map(Object.entries(photos).map(([path, url]): [string, string] => [path.replace(/^.*\/(.+)\.webp$/, '$1'), url]));

/** The URL of the photo for `key`; none while there is no file for it. */
export const plantPhoto = (key: string): string | undefined => byKey.get(key);
