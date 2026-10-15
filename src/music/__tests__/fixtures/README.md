# Music Assistant test fixtures

Hand-written answers in the shape Music Assistant returns through `music_bridge/call`, with invented names,
ids and hosts (`example` domains). The keys are the ones a real answer carries, including those the dashboard
ignores, so the readers are tested against the noise as well.

- `radios.json`: `music/radios/library_items`. Six stations in Music Assistant's order, two of them favorites,
  one with no image.
- `podcasts.json`: `music/podcasts/library_items`. Four shows; one has an empty `metadata`, so no image.
- `playlists.json`: `music/playlists/library_items`. Four Spotify playlists and one of Music Assistant's own
  generated playlists, which has no Spotify mapping, in the library's insertion order (`timestamp_added`), which
  is the order Spotify lists them. One playlist has no image. The tests answer the `played_only` query with two of
  them, the most recently played first.
- `playlist-tracks.json`: `music/playlists/playlist_tracks` as the bridge trims it. Seven tracks in playlist
  order: one with two artists, one with no image, one that Spotify has removed (`available: false`), one with a
  length of 0, one of more than an hour, and one with no artist.
- `episodes.json`: `music/podcasts/podcast_episodes` for the first show. Six episodes in no particular order:
  one unfinished, one played, one with a length of 0, one with no release date, two released at the same moment.
- `in-progress.json`: `music/in_progress_items`. These are short `ItemMapping` objects: the image sits in `image`,
  not in `metadata.images`, and there is no position or length. Two podcast episodes and one audiobook.

Never commit a live export here: this repo is public, and an in-progress list shows what people listen to.
Write fixtures by hand like these.
