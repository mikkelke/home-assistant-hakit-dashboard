export type PodcastFeed = {
  id: string;
  title: string;
  url: string;
  cover?: string;
};

// Add more podcast feeds here as needed
// Podcasts are sorted alphabetically by title
export const PODCAST_FEEDS: PodcastFeed[] = [
  {
    id: 'bangers-med-ena',
    title: 'Bangers med Ena',
    url: 'https://drpodcast.nu/bangers-med-ena/feed.xml',
    cover: 'https://drpodcast.nu/bangers-med-ena/image.jpg',
  },
  {
    id: 'langefredag',
    title: 'Langefredag',
    url: 'https://drpodcast.nu/langefredag/feed.xml',
    cover: 'https://drpodcast.nu/langefredag/image.jpg',
  },
  {
    id: 'musikquizzen',
    title: 'Musikquizzen',
    url: 'https://drpodcast.nu/musikquizzen/feed.xml',
    cover: 'https://drpodcast.nu/musikquizzen/image.jpg',
  },
  {
    id: 'sara-og-monopolet',
    title: 'Sara & Monopolet',
    url: 'https://drpodcast.nu/sara-og-monopolet/feed.xml',
    cover: 'https://drpodcast.nu/sara-og-monopolet/image.jpg',
  },
  {
    id: 'taettere-paa-himlen',
    title: 'Tættere på himlen',
    url: 'https://drpodcast.nu/taettere-paa-himlen/feed.xml',
    cover: 'https://drpodcast.nu/taettere-paa-himlen/image.jpg',
  },
];
