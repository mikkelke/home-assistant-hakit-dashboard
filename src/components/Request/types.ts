export type MediaType = 'movie' | 'tv';

export type Status = 'none' | 'pending' | 'processing' | 'partial' | 'available';

export interface Item {
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  status: Status;
}

export interface ResultPage {
  results: Item[];
  page: number;
  totalPages: number;
}

export interface Season {
  number: number;
  status: Status;
}

export interface Detail extends Item {
  overview: string;
  rating: number | null;
  runtimeMinutes: number | null;
  seasonCount: number | null;
  seasons: Season[];
}

export interface MineItem {
  requestId: number;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  status: Status;
}

export type SeasonSelection = 'all' | number[];

export interface CreateParams {
  mediaType: MediaType;
  tmdbId: number;
  seasons?: SeasonSelection;
}

export interface CreateResult {
  status: Status;
  requestId: number;
}
