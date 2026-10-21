import type { HouseBuilder } from './builder';
import { HaError } from './types';

type Status = 'none' | 'pending' | 'processing' | 'partial' | 'available';

interface Title {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  originalTitle?: string;
  year: number | null;
  posterPath: string | null;
  status: Status;
}

const CATALOG: Title[] = [
  {
    mediaType: 'movie',
    tmdbId: 9001,
    title: 'The Lighthouse Keeper and the Winter Tide',
    year: 2026,
    posterPath: '/p9001.jpg',
    status: 'none',
  },
  {
    mediaType: 'tv',
    tmdbId: 9002,
    title: 'Harbour Lights',
    originalTitle: 'Havnelys',
    year: 2024,
    posterPath: '/p9002.jpg',
    status: 'available',
  },
  { mediaType: 'movie', tmdbId: 9003, title: 'A Quiet Place to Be Loud', year: 2025, posterPath: null, status: 'pending' },
  { mediaType: 'tv', tmdbId: 9004, title: 'Northern Lines', year: 2023, posterPath: '/p9004.jpg', status: 'partial' },
  { mediaType: 'movie', tmdbId: 9005, title: 'Seven Bridges', year: 2022, posterPath: '/p9005.jpg', status: 'processing' },
  {
    mediaType: 'movie',
    tmdbId: 9006,
    title: 'The Extraordinarily Long Title of a Film About a Very Patient Man Who Waited for a Train',
    year: 2021,
    posterPath: null,
    status: 'none',
  },
  { mediaType: 'tv', tmdbId: 9007, title: 'Last Ferry', year: 2026, posterPath: '/p9007.jpg', status: 'none' },
  { mediaType: 'movie', tmdbId: 9008, title: 'Copper Sky', year: null, posterPath: '/p9008.jpg', status: 'none' },
];

const SHOWS = [
  {
    id: 'dr-1',
    title: 'Fyrvogteren',
    path: '/drtv/serie/fyrvogteren_1',
    poster: null,
    overview: 'A lighthouse keeper on the west coast sees more than he should.',
    following: true,
  },
  {
    id: 'dr-2',
    title: 'Aftenens gæster',
    path: '/drtv/serie/aftenens-gaester_2',
    poster: null,
    overview: 'Six dinner parties, six secrets.',
    following: false,
  },
];

export function addRequests(h: HouseBuilder): void {
  const allowed = h.viewer.name !== 'Rooftop';
  h.ws['media_requests/me'] = () => {
    if (!allowed) throw new HaError('forbidden', 'Not allowed');
    return { allowed: true, drtv: h.viewer.isAdmin };
  };
  const page = (results: Title[]) => ({ results, page: 1, totalPages: 3 });
  h.ws['media_requests/discover'] = () => page(CATALOG);
  h.ws['media_requests/search'] = message =>
    page(CATALOG.filter(item => item.title.toLowerCase().includes(String(message.query).toLowerCase())));
  h.ws['media_requests/detail'] = message => {
    const item = CATALOG.find(candidate => candidate.tmdbId === message.tmdbId) ?? CATALOG[0];
    return {
      ...item,
      overview: 'A winter on the coast, told in six letters that never reached the people they were written for.',
      rating: 7.4,
      runtimeMinutes: item.mediaType === 'movie' ? 112 : null,
      seasonCount: item.mediaType === 'tv' ? 3 : null,
      seasons: item.mediaType === 'tv' ? [1, 2, 3].map(number => ({ number, status: number === 1 ? 'available' : 'none' })) : [],
    };
  };
  h.ws['media_requests/mine'] = () => ({
    items: CATALOG.filter(item => item.status !== 'none').map((item, index) => ({
      requestId: 100 + index,
      mediaType: item.mediaType,
      tmdbId: item.tmdbId,
      title: item.title,
      posterPath: item.posterPath,
      status: item.status,
    })),
  });
  h.ws['media_requests/create'] = () => ({ status: 'pending', requestId: 200 });
  h.ws['media_requests/drtv_search'] = () => ({ results: SHOWS });
  h.ws['media_requests/drtv_following'] = () => ({
    series: SHOWS.filter(show => show.following).map(show => ({ ...show, listed: 24, downloaded: 18 })),
  });
}
