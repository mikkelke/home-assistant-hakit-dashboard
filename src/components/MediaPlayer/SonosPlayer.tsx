import { useState, useEffect, useMemo, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { SonosPlayerProps } from '../../types';
import { SONOS_SPEAKERS } from '../../config/speakers';
import { RADIO_STATIONS } from '../../config/radio';
import { PODCAST_FEEDS } from '../../config/podcasts';
import { useSwipeToClose } from '../../hooks';
import './SonosPlayer.css';

type SonosAttributes = {
  media_title?: string;
  media_artist?: string;
  entity_picture?: string;
  entity_picture_local?: string;
  volume_level?: number;
  is_volume_muted?: boolean;
  group_members?: Array<string | null | undefined>;
  source_list?: string[];
  source?: string;
  media_content_id?: string;
  media_duration?: number;
  media_position?: number;
  media_position_updated_at?: string;
  app_id?: string;
};

// Normalize media_content_id to better detect known radio stations
const normalizeContentId = (id: string) => {
  if (!id) return { full: '', base: '' };
  let url = id;
  const prefixes = ['builtin://radio/', 'hls-radio://', 'x-rincon-mp3radio://', 'radio://'];
  prefixes.forEach(p => {
    if (url.startsWith(p)) {
      url = url.slice(p.length);
    }
  });
  const full = url;
  const base = url.split('?')[0];
  return { full, base };
};

/**
 * Get the master/coordinator speaker from a Sonos entity's group_members attribute.
 * The master is always group_members[0] per Home Assistant/Sonos integration.
 *
 * IMPORTANT: This function reads directly from entity state attributes, never from
 * input_select or other external sources. This ensures robust master detection
 * that matches the actual Sonos group state.
 *
 * @param entity - The Sonos entity object (from entities state)
 * @param fallbackEntityId - Fallback entity ID if group_members is empty/invalid
 * @returns The entity ID of the master speaker
 */
const getMasterFromEntity = (entity: { attributes?: { group_members?: unknown[] } } | null, fallbackEntityId: string): string => {
  if (!entity?.attributes?.group_members) return fallbackEntityId;
  const groupMembers = entity.attributes.group_members;
  const validMembers = groupMembers.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  // Master is always the first member (group_members[0]), or fallback to the entity itself if empty
  return validMembers.length > 0 ? validMembers[0] : fallbackEntityId;
};

export function SonosPlayer({ entityId, entities, hassUrl, callService }: SonosPlayerProps) {
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showVolumeMixer, setShowVolumeMixer] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [volumeUi, setVolumeUi] = useState(0);
  const [mixerVolumes, setMixerVolumes] = useState<Record<string, number>>({});
  const [podcastEpisodes, setPodcastEpisodes] = useState<Record<string, Array<{ title: string; url: string; pubDate?: string }>>>({});
  const [podcastLoading, setPodcastLoading] = useState<string | null>(null);
  const [podcastError, setPodcastError] = useState<string | null>(null);
  const [showPodcastModal, setShowPodcastModal] = useState(false);
  const podcastModalOpenedAt = useRef<number>(0);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string | null>(null);
  const [viewingEpisodes, setViewingEpisodes] = useState(false);
  const [seekerPreview, setSeekerPreview] = useState<number | null>(null); // position in seconds while dragging
  const [, setSeekerTick] = useState(0); // force re-render for live position when playing
  const player = entities?.[entityId];

  // Use safe fallbacks when player is missing so all hooks run unconditionally (avoids React #300 when switching rooms)
  const state = player?.state ?? 'unavailable';
  const attributes: SonosAttributes = (player?.attributes ?? {}) as SonosAttributes;
  const mediaTitle = attributes.media_title || 'Not playing';
  const mediaArtist = attributes.media_artist || '';
  const mediaPicture = attributes.entity_picture;
  const mediaPictureLocal = attributes.entity_picture_local;
  const volume = Math.round((attributes.volume_level ?? 0) * 100);
  const isMuted = attributes.is_volume_muted;
  const groupMembers = useMemo(() => {
    const raw: Array<string | null | undefined> = Array.isArray(attributes.group_members) ? attributes.group_members : [entityId];
    const filtered = (raw || []).filter((id): id is string => typeof id === 'string' && id.length > 0);
    return filtered.length > 0 ? filtered : [entityId];
  }, [attributes.group_members, entityId]);
  // Determine master from entity state: group_members[0] is always the coordinator/master
  const masterId = getMasterFromEntity(player ?? null, entityId);
  const sortedGroupMembers = [...groupMembers].sort((a, b) => {
    const aName = SONOS_SPEAKERS.find(s => s.id === a)?.name || a.split('.')[1] || a;
    const bName = SONOS_SPEAKERS.find(s => s.id === b)?.name || b.split('.')[1] || b;
    return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  });
  const sourceList: string[] = Array.isArray(attributes.source_list)
    ? attributes.source_list.filter((s): s is string => typeof s === 'string')
    : [];
  const currentSource = attributes.source || '';
  const mediaContentId = attributes.media_content_id || '';
  const mediaDuration = typeof attributes.media_duration === 'number' ? attributes.media_duration : undefined;
  const mediaPosition = typeof attributes.media_position === 'number' ? attributes.media_position : undefined;
  const mediaPositionUpdatedAt = attributes.media_position_updated_at;

  // Detect current radio station (handle wrapped URLs from automations)
  const normalized = normalizeContentId(mediaContentId);
  const currentRadio = RADIO_STATIONS.find(station => {
    const stationBase = station.mediaId.split('?')[0];
    const stationNameKey = station.name.toLowerCase().replace('dr ', '').trim();
    // Check if normalized URL contains station base URL (works for wrapped URLs)
    const urlMatch =
      (normalized.full && normalized.full.includes(stationBase)) || (normalized.base && normalized.base.includes(stationBase));
    // Also check if media_title matches station name (for cases where URL might differ)
    const titleMatch = mediaTitle && mediaTitle.toLowerCase().includes(stationNameKey);
    return urlMatch || titleMatch;
  });

  // Detect Spotify based on media_content_id, app_id, or entity_picture
  const isSpotify = Boolean(
    mediaContentId?.toLowerCase().startsWith('spotify') ||
    attributes?.app_id?.toLowerCase() === 'spotify' ||
    attributes?.entity_picture?.toLowerCase().includes('spotify')
  );

  // Helper function to normalize titles for matching
  const normalizeTitle = (str: string) =>
    str
      .toLowerCase()
      .replace(/podcast/g, '')
      .replace(/&/g, '')
      .replace(/[:\-–—]/g, ' ') // Replace colons and dashes with spaces
      .replace(/\s+/g, ' ')
      .trim();

  // Extract key words from a title (removes common words and keeps meaningful terms)
  const extractKeywords = (str: string) => {
    const normalized = normalizeTitle(str);
    // Remove common words that don't help with matching
    const stopWords = [
      'med',
      'og',
      'et',
      'en',
      'den',
      'det',
      'de',
      'der',
      'som',
      'på',
      'til',
      'for',
      'af',
      'i',
      'er',
      'har',
      'var',
      'blev',
      'blev',
      'kan',
      'skal',
      'vil',
      'må',
      'all',
    ];
    return normalized
      .split(' ')
      .filter(word => word.length > 2 && !stopWords.includes(word))
      .join(' ');
  };

  // Detect podcast - check multiple ways:
  // 1. media_content_id contains "podcastfeed"
  // 2. media_title matches podcast title (using normalized matching)
  // 3. media_artist matches podcast feed URL domain (e.g., "DR" for DR podcasts)
  // 4. DR API URLs (api.dr.dk) with matching titles
  // BUT: Skip podcast detection if we already detected a radio station
  // AND: Skip podcast detection if source is TV
  // Allow detection when playing, paused, OR idle (if there's media content)
  const isPlayingState = state === 'playing' || state === 'paused';
  const hasMediaContent = mediaTitle && mediaTitle !== 'Not playing' && mediaContentId;
  const canDetectPodcast = isPlayingState || (state === 'idle' && hasMediaContent);
  const isTVSource = currentSource && currentSource.toLowerCase().includes('tv');
  const isPodcastById = !currentRadio && !isTVSource && canDetectPodcast && mediaContentId?.includes('podcastfeed');
  const isDRApiUrl = mediaContentId?.includes('api.dr.dk') || mediaContentId?.includes('dr.dk/radio');

  let currentPodcast = null;

  // Only detect podcast if it's not a radio station, not TV source, and has media content
  if (!currentRadio && !isTVSource && canDetectPodcast) {
    // First try to match by media_content_id URL pattern (podcastfeed or DR API)
    if (isPodcastById || isDRApiUrl) {
      currentPodcast = PODCAST_FEEDS.find(feed => {
        const feedBaseUrl = feed.url.replace('/feed.xml', '');
        // Check for direct feed URL match
        if (mediaContentId.includes(feedBaseUrl)) return true;
        // For DR API URLs, check if feed URL domain matches
        if (isDRApiUrl && feed.url.includes('drpodcast.nu')) {
          return true; // Will be refined by title matching below
        }
        return false;
      });
    }

    // If not found, try to match by title (normalize for better matching)
    // Only match if media_title is not empty and not generic
    if (!currentPodcast && mediaTitle && mediaTitle !== 'Not playing' && mediaTitle.length > 3) {
      currentPodcast = PODCAST_FEEDS.find(feed => {
        const titleNormalized = normalizeTitle(mediaTitle);
        const feedTitleNormalized = normalizeTitle(feed.title);

        // Require a stronger match - both titles should be substantial
        if (titleNormalized.length < 5 || feedTitleNormalized.length < 5) return false;

        // Check if normalized titles match or contain each other
        if (titleNormalized.includes(feedTitleNormalized) || feedTitleNormalized.includes(titleNormalized)) {
          return true;
        }

        // Also try keyword matching for better episode title matching
        // This helps match "Nytårsbangers med Ena: Et all" to "Bangers med Ena"
        const titleKeywords = extractKeywords(mediaTitle);
        const feedKeywords = extractKeywords(feed.title);

        // Check if key words from podcast feed are present in episode title
        if (feedKeywords && titleKeywords) {
          const feedWords = feedKeywords.split(' ').filter(w => w.length >= 3);
          const titleWords = titleKeywords.split(' ');
          // Match words from feed to title (allowing partial matches)
          const matchingWords = feedWords.filter(feedWord =>
            titleWords.some(titleWord => titleWord.includes(feedWord) || feedWord.includes(titleWord))
          );
          // If we have at least one substantial match (4+ chars) OR multiple shorter matches, consider it a match
          const hasSubstantialMatch = matchingWords.some(word => word.length >= 4);
          if (hasSubstantialMatch || matchingWords.length >= 2) {
            return true;
          }
        }

        return false;
      });
    }

    // If still not found and media_artist is "DR", try to match by feed URL domain
    // This helps when episode titles don't directly match but we know it's from DR
    // Also check for DR API URLs
    if (!currentPodcast && mediaArtist && mediaArtist.toLowerCase() === 'dr') {
      // Check if any DR podcast feed URL matches the media_content_id or if it's a DR API URL
      currentPodcast = PODCAST_FEEDS.find(feed => {
        if (feed.url.includes('drpodcast.nu')) {
          // If media_content_id contains drpodcast.nu or DR API URL, it's likely a DR podcast
          return mediaContentId?.includes('drpodcast.nu') || mediaContentId?.includes('drpodcast') || isDRApiUrl;
        }
        return false;
      });
    }
  }

  // Consider it a podcast if we found a match OR if media_content_id contains podcastfeed or DR API URL
  // But only if it's not a radio station, not TV source, and has media content
  const isPodcast = !currentRadio && !isTVSource && canDetectPodcast && (isPodcastById || isDRApiUrl || currentPodcast !== null);

  // Prefer entity picture; fallback to station logo or podcast cover when known
  const fallbackLogo = currentRadio?.logo || currentPodcast?.cover || null;

  // Check if entity picture is likely a placeholder (generic icon)
  const isPlaceholderImage = (url: string | null | undefined): boolean => {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    // Common placeholder patterns in Home Assistant
    return (
      urlLower.includes('default') ||
      urlLower.includes('placeholder') ||
      urlLower.includes('icon') ||
      urlLower.includes('music-note') ||
      urlLower.includes('music_note') ||
      (urlLower.includes('/local/') && (urlLower.includes('icon') || urlLower.includes('default')))
    );
  };

  const pickImage = () => {
    const candidate = mediaPictureLocal || mediaPicture;
    // If we have a detected podcast/radio with cover and the entity picture is a placeholder, prefer the cover
    if (fallbackLogo && candidate && isPlaceholderImage(candidate)) {
      return fallbackLogo;
    }
    if (candidate) {
      return candidate.startsWith('http') ? candidate : `${hassUrl}${candidate}`;
    }
    return fallbackLogo;
  };
  const imageUrl = pickImage();

  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  // If we have a fallback logo and no entity picture, use fallback directly
  // If entity picture is a placeholder and we have a podcast/radio cover, prefer the cover
  // Otherwise use imageUrl and fallback to fallbackLogo on error
  const entityPicture = mediaPictureLocal || mediaPicture;
  const isPlaceholder = entityPicture ? isPlaceholderImage(entityPicture) : false;
  const resolvedImage =
    !entityPicture && fallbackLogo
      ? fallbackLogo
      : isPlaceholder && fallbackLogo
        ? fallbackLogo
        : imageError && fallbackLogo
          ? fallbackLogo
          : imageUrl;
  const isSameOrigin = (url: string | null | undefined) => {
    if (!url || typeof window === 'undefined') return false;
    try {
      const u = new URL(url, window.location.href);
      return u.origin === window.location.origin;
    } catch {
      return false;
    }
  };

  // Allow entity pictures from the Home Assistant server (e.g. /api/media_player_proxy/...)
  // so images load when the dashboard runs on a different origin (e.g. Vite dev or separate host)
  const isHassUrl = (url: string | null | undefined) => {
    if (!url || !hassUrl) return false;
    try {
      const u = new URL(url, window.location.href);
      const hassOrigin = new URL(hassUrl, window.location.href).origin;
      return u.origin === hassOrigin;
    } catch {
      return false;
    }
  };

  // Allow external URLs for podcast covers and radio logos (known safe sources)
  const isExternalAllowed = (url: string | null | undefined) => {
    if (!url) return false;
    // Check if it's a podcast cover or radio logo
    return currentPodcast?.cover === url || currentRadio?.logo === url;
  };

  const safeImage =
    resolvedImage && (isSameOrigin(resolvedImage) || isHassUrl(resolvedImage) || isExternalAllowed(resolvedImage))
      ? resolvedImage
      : undefined;
  const showImage = safeImage && !imageError;
  const isPlaying = state === 'playing';
  const hasGroup = groupMembers.length > 1;

  // Check if MA and Sonos entities are out of sync
  // Only check if current entity is a MA entity (doesn't end with _2)
  const isMAEntity = !entityId.endsWith('_2');
  const sonosEntityId = isMAEntity ? `${entityId}_2` : null;
  const sonosEntity = sonosEntityId ? entities?.[sonosEntityId] : null;

  // Compare states - they're out of sync if:
  // 1. Both entities exist
  // 2. Their states differ in a meaningful way (playing vs paused/idle, or vice versa)
  // We consider them synced if both are idle/off/unavailable (not playing)
  const isOutOfSync =
    isMAEntity &&
    sonosEntity &&
    (() => {
      const maState = state;
      const sonosState = sonosEntity.state;

      // If states are the same, they're in sync
      if (maState === sonosState) return false;

      // If one is playing and the other is not, they're out of sync
      if (maState === 'playing' && sonosState !== 'playing') return true;
      if (sonosState === 'playing' && maState !== 'playing') return true;

      // If one is paused and the other is playing, they're out of sync
      if (maState === 'paused' && sonosState === 'playing') return true;
      if (sonosState === 'paused' && maState === 'playing') return true;

      // Otherwise, consider them in sync (both idle/off/unavailable)
      return false;
    })();

  const groupedSpeakers = useMemo(() => {
    const speakers = groupMembers.map((id, index) => {
      const speaker = SONOS_SPEAKERS.find(s => s.id === id);
      const entity = entities?.[id];
      return {
        id,
        name: speaker?.name || id.split('.')[1],
        volume: Math.round((Number(entity?.attributes?.volume_level) || 0) * 100),
        isMuted: entity?.attributes?.is_volume_muted || false,
        isMaster: index === 0, // First speaker is the coordinator/master
      };
    });
    const master = speakers.find(s => s.isMaster);
    const others = speakers.filter(s => !s.isMaster).sort((a, b) => a.name.localeCompare(b.name));
    return master ? [master, ...others] : others;
  }, [groupMembers, entities]);

  useEffect(() => {
    setVolumeUi(volume);
  }, [volume]);

  // Initialize mixer volumes when mixer opens (only once per open)
  useEffect(() => {
    if (!(showVolumeMixer && hasGroup)) return;
    const initialVolumes: Record<string, number> = {};
    groupedSpeakers.forEach(speaker => {
      initialVolumes[speaker.id] = speaker.volume;
    });
    setMixerVolumes(prev => {
      // Only replace if different to avoid re-render loops
      const sameKeys =
        Object.keys(prev).length === Object.keys(initialVolumes).length &&
        Object.keys(initialVolumes).every(k => prev[k] === initialVolumes[k]);
      return sameKeys ? prev : initialVolumes;
    });
  }, [showVolumeMixer, hasGroup, groupedSpeakers]);

  // Close group modal
  const closeGroupModal = () => {
    setShowGroupModal(false);
  };

  // Use standardized swipe-to-close hook for group modal
  const {
    handleTouchStart: handleModalTouchStart,
    handleTouchMove: handleModalTouchMove,
    handleTouchEnd: handleModalTouchEnd,
  } = useSwipeToClose(closeGroupModal);

  // Handle back button for group modal
  useEffect(() => {
    if (!showGroupModal) return;

    const handleModalBack = (e: Event) => {
      // Prevent Dashboard from closing the room detail
      e.preventDefault();
      closeGroupModal();
    };

    window.addEventListener('modalBackButton', handleModalBack);
    return () => window.removeEventListener('modalBackButton', handleModalBack);
  }, [showGroupModal]);

  // Helper to check if source is line-in and get display name
  const isLineIn = (source: string) => {
    if (!source) return false;
    const lower = source.toLowerCase();
    return (
      lower === 'line_in' ||
      lower === 'line-in' ||
      lower === 'line in' ||
      lower === 'audiocast' ||
      lower.includes('line') ||
      lower.includes('audiocast')
    );
  };

  // Helper to check if current source is AirPlay (cast from iPhone/iPad to Sonos)
  const isAirPlaySource = (source: string) => {
    if (!source) return false;
    return source.toLowerCase().includes('airplay');
  };
  const isAirPlay = isAirPlaySource(currentSource) || attributes.app_id?.toLowerCase() === 'airplay';

  // Helper to check if a source name is TV
  const isTVSourceName = (source: string) => {
    if (!source) return false;
    const lower = source.toLowerCase();
    return lower.includes('tv') || lower === 'television';
  };

  const getSourceDisplayName = (source: string) => {
    if (isLineIn(source)) return 'Audiocast';

    if (isAirPlaySource(source)) return 'AirPlay';
    return source;
  };

  // When source is Audiocast (line-in), HA often leaves media_title empty – show "Audiocast" instead of "Not playing"
  const displayTitle =
    currentRadio?.name ||
    (isLineIn(currentSource) && (!mediaTitle || mediaTitle === 'Not playing') ? 'Audiocast' : mediaTitle) ||
    'Not playing';

  // Determine source display - check specific sources first, then state
  const getDisplaySource = () => {
    // Check specific sources in priority order (regardless of state)
    if (isSpotify) return 'Spotify';
    if (currentRadio) return currentRadio.name; // Radio should show even when idle

    // Check for TV source BEFORE podcast detection (TV should take priority)
    if (currentSource && currentSource.toLowerCase().includes('tv')) {
      return 'TV';
    }

    // Check AirPlay BEFORE podcast – when casting a podcast via AirPlay, show "AirPlay" as source
    if (isAirPlay) return 'AirPlay';

    if (isPodcast) return 'Podcast'; // Podcast detected (playing, paused, or idle with media)

    // Check if it's Audiocast (line-in) - should show even when idle if source is set
    if (isLineIn(currentSource)) return 'Audiocast';

    // If current source is "Music Assistant Queue" (the default), show "Select source"
    if (currentSource) {
      const sourceLower = currentSource.toLowerCase();
      if (sourceLower.includes('music assistant queue') || sourceLower.includes('music assistant')) {
        return 'Select source';
      }
      // If we have a source but no specific match, show the source name
      return getSourceDisplayName(currentSource);
    }

    // Only show "Select source" if truly idle/off/unavailable with no media content
    if ((state === 'idle' || state === 'off' || state === 'unavailable') && !mediaContentId && !currentSource) {
      return 'Select source';
    }

    // Fallback
    return 'Select source';
  };

  const displaySource = getDisplaySource();
  const masterSpeakerName = hasGroup ? groupedSpeakers.find(s => s.isMaster)?.name || '' : '';

  // --- Media seeker: only when relevant (not radio, not audiocast/line-in) ---
  const showSeeker =
    !currentRadio && !isLineIn(currentSource) && mediaDuration != null && mediaDuration > 0 && mediaPosition != null && mediaPosition >= 0;

  const getCurrentPosition = (): number => {
    if (seekerPreview != null) return seekerPreview;
    if (mediaPosition == null || mediaDuration == null) return 0;
    if (state === 'playing' && mediaPositionUpdatedAt) {
      try {
        const updatedAt = new Date(mediaPositionUpdatedAt).getTime() / 1000;
        const now = Date.now() / 1000;
        const elapsed = now - updatedAt;
        return Math.min(mediaPosition + elapsed, mediaDuration);
      } catch {
        return mediaPosition;
      }
    }
    return mediaPosition;
  };

  const currentPosition = showSeeker ? getCurrentPosition() : 0;
  const seekDuration = mediaDuration ?? 0;

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (positionSeconds: number) => {
    if (!callService || seekDuration <= 0) return;
    const clamped = Math.max(0, Math.min(seekDuration, positionSeconds));
    callService({
      domain: 'media_player',
      service: 'media_seek',
      target: { entity_id: entityId },
      serviceData: { seek_position: clamped },
    });
    setSeekerPreview(null);
  };

  // Update progress bar every second when playing (so position moves without waiting for HA state)
  useEffect(() => {
    if (!showSeeker || state !== 'playing') return;
    const id = setInterval(() => setSeekerTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [showSeeker, state]);

  // Service calls
  const handlePlayPause = () => {
    if (!callService) return;

    // Line-in/Audiocast does not support play/pause – use media_stop to stop playback
    if (isPlaying && isLineIn(currentSource)) {
      callService({
        domain: 'media_player',
        service: 'media_stop',
        target: { entity_id: entityId },
      });
      return;
    }

    // When playing, pause
    if (isPlaying) {
      callService({
        domain: 'media_player',
        service: 'media_pause',
        target: { entity_id: entityId },
      });
      return;
    }

    // When paused, resume
    if (state === 'paused') {
      callService({
        domain: 'media_player',
        service: 'media_play',
        target: { entity_id: entityId },
      });
      return;
    }

    // When idle with media content, try to resume playback
    // For Music Assistant, media_play should work even when idle
    if (state === 'idle' && mediaContentId) {
      callService({
        domain: 'media_player',
        service: 'media_play',
        target: { entity_id: entityId },
      });
      return;
    }

    // Fallback: try media_play for any other state
    callService({
      domain: 'media_player',
      service: 'media_play',
      target: { entity_id: entityId },
    });
  };

  const handlePrevious = () => {
    if (!callService) return;
    callService({ domain: 'media_player', service: 'media_previous_track', target: { entity_id: entityId } });
  };

  const handleNext = () => {
    if (!callService) return;
    callService({ domain: 'media_player', service: 'media_next_track', target: { entity_id: entityId } });
  };

  const handleVolumeChange = (speakerId: string, newVolume: number) => {
    if (!callService) return;
    callService({
      domain: 'media_player',
      service: 'volume_set',
      target: { entity_id: speakerId },
      serviceData: { volume_level: newVolume / 100 },
    });
  };

  const clampVolume = (v: number) => Math.max(0, Math.min(100, v));

  const handleVolumeStep = (delta: number) => {
    const next = clampVolume(volumeUi + delta);
    setVolumeUi(next);
    handleVolumeChange(entityId, next);
  };

  const handleMixerVolumeStep = (speakerId: string, delta: number) => {
    const current = mixerVolumes[speakerId] ?? groupedSpeakers.find(s => s.id === speakerId)?.volume ?? 0;
    const next = clampVolume(current + delta);
    setMixerVolumes(prev => ({ ...prev, [speakerId]: next }));
    handleVolumeChange(speakerId, next);
  };

  const handleMixerMuteToggle = (speakerId: string) => {
    if (!callService) return;
    const speaker = groupedSpeakers.find(s => s.id === speakerId);
    if (!speaker) return;
    callService({
      domain: 'media_player',
      service: 'volume_mute',
      target: { entity_id: speakerId },
      serviceData: { is_volume_muted: !speaker.isMuted },
    });
  };

  const parseRss = (xmlText: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const items = Array.from(doc.querySelectorAll('item'));
    return items
      .map(item => {
        const title = item.querySelector('title')?.textContent?.trim() || 'Episode';
        const enclosure = item.querySelector('enclosure');
        const url = enclosure?.getAttribute('url') || '';
        const pubDate = item.querySelector('pubDate')?.textContent || '';
        return url ? { title, url, pubDate } : null;
      })
      .filter(Boolean) as Array<{ title: string; url: string; pubDate?: string }>;
  };

  const fetchPodcast = async (feedId: string, feedUrl: string) => {
    setPodcastLoading(feedId);
    setPodcastError(null);
    try {
      const res = await fetch(feedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const eps = parseRss(text);
      setPodcastEpisodes(prev => ({ ...prev, [feedId]: eps }));
    } catch (err: unknown) {
      setPodcastError(err instanceof Error ? err.message : 'Failed to load feed');
      setPodcastEpisodes(prev => ({ ...prev, [feedId]: [] }));
    } finally {
      setPodcastLoading(null);
    }
  };

  useEffect(() => {
    if (showPodcastModal && selectedPodcastId && viewingEpisodes) {
      const feed = PODCAST_FEEDS.find(f => f.id === selectedPodcastId);
      if (feed && !podcastEpisodes[feed.id]) {
        fetchPodcast(feed.id, feed.url);
      }
    }
    // Intentionally omit fetchPodcast and podcastEpisodes to avoid re-running when episodes load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPodcastModal, selectedPodcastId, viewingEpisodes]);

  // Browser back button support (capture to avoid closing the whole room)
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (showPodcastModal) {
        event.stopImmediatePropagation();
        if (viewingEpisodes) {
          // Go back to podcast list
          setViewingEpisodes(false);
          try {
            window.history.replaceState({ podcastModal: true, viewingEpisodes: false }, '', window.location.pathname);
          } catch {
            /* ignore */
          }
        } else {
          setShowPodcastModal(false);
          setViewingEpisodes(false);
          setSelectedPodcastId(null);
          try {
            window.history.replaceState({ podcastModal: null }, '', window.location.pathname);
          } catch {
            /* ignore */
          }
        }
      }
    };
    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => window.removeEventListener('popstate', handlePopState, { capture: true });
  }, [showPodcastModal, viewingEpisodes]);

  // Custom swipe handler for podcast modal (needs special logic for back navigation)
  const handlePodcastSwipe = () => {
    if (viewingEpisodes) {
      setViewingEpisodes(false);
      try {
        window.history.replaceState({ podcastModal: true, viewingEpisodes: false }, '', window.location.pathname);
      } catch {
        /* ignore */
      }
    } else {
      handleClosePodcastModal();
    }
  };

  // Use standardized swipe-to-close hook for podcast modal
  const {
    handleTouchStart: handlePodcastTouchStart,
    handleTouchMove: handlePodcastTouchMove,
    handleTouchEnd: handlePodcastTouchEnd,
  } = useSwipeToClose(handlePodcastSwipe);

  const handleClosePodcastModal = () => {
    // Ignore overlay click that fires right after open (synthetic click from same tap on touch devices)
    const now = Date.now();
    if (now - podcastModalOpenedAt.current < 400) return;
    setShowPodcastModal(false);
    setViewingEpisodes(false);
    setSelectedPodcastId(null);
    try {
      window.history.replaceState({ podcastModal: null }, '', window.location.pathname);
    } catch {
      /* ignore */
    }
  };

  const handleSelectPodcast = (feedId: string) => {
    setSelectedPodcastId(feedId);
    setViewingEpisodes(true);
    const feed = PODCAST_FEEDS.find(f => f.id === feedId);
    if (feed && !podcastEpisodes[feed.id]) {
      fetchPodcast(feed.id, feed.url);
    }
    try {
      window.history.pushState({ podcastModal: true, viewingEpisodes: true, feedId }, '', window.location.pathname);
    } catch {
      /* ignore */
    }
  };

  const handleBackToPodcasts = () => {
    setViewingEpisodes(false);
    try {
      window.history.replaceState({ podcastModal: true, viewingEpisodes: false }, '', window.location.pathname);
    } catch {
      /* ignore */
    }
  };

  const handleSpotifyClick = (e: React.MouseEvent) => {
    const isEmbedded = window.self !== window.top;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;

    if (isIOS) {
      try {
        const opened = window.open('spotify://', '_blank');
        if (!opened || opened.closed || typeof opened.closed === 'undefined') {
          const link = document.createElement('a');
          link.href = 'spotify://';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            try {
              document.body.removeChild(link);
            } catch {
              /* ignore */
            }
          }, 100);
        }
      } catch {
        /* ignore */
      }
      try {
        window.location.href = 'spotify://';
      } catch {
        /* ignore */
      }
      (() => {
        const link2 = document.createElement('a');
        link2.href = 'spotify://';
        link2.style.display = 'none';
        document.body.appendChild(link2);
        link2.click();
        setTimeout(() => {
          try {
            document.body.removeChild(link2);
          } catch {
            /* ignore */
          }
        }, 100);
      })();
      if (!isEmbedded) {
        setTimeout(() => {
          window.open('https://open.spotify.com', '_blank');
        }, 1000);
      }
    } else {
      e.preventDefault();
      let appOpened = false;
      const startTime = Date.now();
      const handleBlur = () => {
        appOpened = true;
        window.removeEventListener('blur', handleBlur);
      };
      window.addEventListener('blur', handleBlur);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'spotify://';
      document.body.appendChild(iframe);
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 100);
      setTimeout(() => {
        window.removeEventListener('blur', handleBlur);
        if (!appOpened && document.hasFocus()) {
          const elapsed = Date.now() - startTime;
          if (elapsed > 800 && !isEmbedded) {
            window.open('https://open.spotify.com', '_blank');
          }
        }
      }, 1200);
    }
  };

  const handleMuteToggle = () => {
    if (!callService) return;
    callService({
      domain: 'media_player',
      service: 'volume_mute',
      target: { entity_id: entityId },
      serviceData: { is_volume_muted: !isMuted },
    });
  };

  const handlePlayRadio = (stationId: string) => {
    if (!callService) return;
    const station = RADIO_STATIONS.find(s => s.id === stationId);
    if (!station) return;

    const targetId = hasGroup ? groupMembers[0] : entityId; // ensure we target coordinator when grouped
    const mediaContentId = station.maMediaId || station.mediaId;
    const mediaContentType = station.maMediaType || station.mediaType || 'music';

    callService({
      domain: 'media_player',
      service: 'play_media',
      target: { entity_id: targetId },
      serviceData: {
        media_content_id: mediaContentId,
        media_content_type: mediaContentType,
      },
    });
    setShowSourcePicker(false);
  };

  const handleSelectSource = (source: string) => {
    if (!callService) return;
    callService({
      domain: 'media_player',
      service: 'select_source',
      target: { entity_id: entityId },
      serviceData: { source },
    });
    setShowSourcePicker(false);
  };

  // Add a speaker to the current group
  // Per HA docs: entity_id = master whose playback expands, group_members = speakers to sync
  // https://www.home-assistant.io/integrations/media_player/
  const handleJoinGroup = async (targetSpeakerId: string) => {
    if (!callService) return;

    const targetSpeakerEntity = entities?.[targetSpeakerId];
    if (!targetSpeakerEntity) {
      console.warn(`[SonosPlayer] Target speaker ${targetSpeakerId} not found in entities`);
      return;
    }

    // Robustly determine target's master from entity state (never from input_select)
    const targetGroupMasterId = getMasterFromEntity(targetSpeakerEntity, targetSpeakerId);
    const rawTargetMembers = targetSpeakerEntity?.attributes?.group_members;
    const targetGroupMembers: string[] = Array.isArray(rawTargetMembers)
      ? rawTargetMembers.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [targetSpeakerId];
    const isTargetInGroup = targetGroupMembers.length > 1;
    const targetGroupMaster = isTargetInGroup ? targetGroupMasterId : null;

    // Check if current speaker is a solo master (playing independently)
    // A solo master has empty group_members or group_members with only itself, and is playing
    const rawGroupMembers = attributes.group_members || [];
    const isCurrentSoloMaster =
      state === 'playing' &&
      (rawGroupMembers.length === 0 ||
        (rawGroupMembers.length === 1 && rawGroupMembers[0] === entityId) ||
        (groupMembers.length === 1 && groupMembers[0] === entityId));

    // If current speaker is a solo master, unjoin it first to avoid "already synced" error
    if (isCurrentSoloMaster) {
      console.log(`[SonosPlayer] Unjoining solo master ${entityId} before grouping`);
      await callService({
        domain: 'media_player',
        service: 'unjoin',
        target: { entity_id: entityId },
      });
      // Give Sonos a moment to process the unjoin
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (isTargetInGroup && targetGroupMaster) {
      // Target is in another group - join current speaker to target's group
      callService({
        domain: 'media_player',
        service: 'join',
        target: { entity_id: targetGroupMaster },
        serviceData: { group_members: [entityId] },
      });
    } else {
      // Target is not in a group - expand current group (or create new group) to include target
      // If we unjoined a solo master, use entityId; otherwise use masterId
      const groupMaster = isCurrentSoloMaster ? entityId : masterId;
      callService({
        domain: 'media_player',
        service: 'join',
        target: { entity_id: groupMaster },
        serviceData: { group_members: [targetSpeakerId] },
      });
    }
  };

  // Remove a speaker from the group
  // Can remove any speaker, not just the current one
  const handleRemoveFromGroup = (speakerId: string) => {
    if (!callService) return;
    callService({
      domain: 'media_player',
      service: 'unjoin',
      target: { entity_id: speakerId },
    });
    // Close modal if removing the current speaker
    if (speakerId === entityId) {
      closeGroupModal();
    }
  };

  const otherSpeakers = SONOS_SPEAKERS.filter(s => !groupMembers.includes(s.id)).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  useEffect(() => {
    // Sync mixer volumes from entity state when group changes
    setMixerVolumes(prev => {
      let changed = false;
      const next = { ...prev };
      groupedSpeakers.forEach(s => {
        if (next[s.id] === undefined) {
          next[s.id] = s.volume;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSpeakers]);

  if (!player) return <div className='sonos-player'>Speaker not found</div>;

  return (
    <div className='sonos-player compact'>
      {/* Now Playing Row */}
      <div className='sonos-now-playing'>
        <div className='sonos-artwork'>
          {showImage ? (
            <img src={safeImage || ''} alt='' onError={() => setImageError(true)} />
          ) : (
            <div className='sonos-artwork-placeholder'>
              <Icon icon={isLineIn(currentSource) ? 'mdi:cast' : 'mdi:music'} />
            </div>
          )}
        </div>
        <div className='sonos-track-info'>
          <span className='sonos-title'>{displayTitle}</span>
          {mediaArtist && <span className='sonos-artist'>{mediaArtist}</span>}
        </div>
        <div className='sonos-status-indicators'>
          {isOutOfSync && (
            <div
              className='sonos-sync-warning'
              title='Music Assistant and Sonos entities are out of sync. Controls may not work correctly.'
            >
              <Icon icon='mdi:alert-circle' />
            </div>
          )}
          {hasGroup && masterSpeakerName && (
            <div className='sonos-master-chip' title='Master speaker'>
              <Icon icon='mdi:crown' />
              <span>{masterSpeakerName}</span>
            </div>
          )}
        </div>
        {/* Inline controls */}
        <div className='sonos-inline-controls'>
          <button className='sonos-btn-sm' onClick={handlePrevious}>
            <Icon icon='mdi:skip-previous' />
          </button>
          <button
            className={`sonos-btn-sm play ${isPlaying ? 'playing' : ''}`}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              handlePlayPause();
            }}
            type='button'
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <Icon icon={isPlaying ? 'mdi:pause' : 'mdi:play'} />
          </button>
          <button className='sonos-btn-sm' onClick={handleNext}>
            <Icon icon='mdi:skip-next' />
          </button>
        </div>
      </div>

      {/* Media seeker – only for seekable content (not radio, not audiocast) */}
      {showSeeker && seekDuration > 0 && (
        <div className='sonos-seeker'>
          <span className='sonos-seeker-time' aria-hidden='true'>
            {formatTime(currentPosition)}
          </span>
          <input
            type='range'
            className='sonos-seeker-input'
            min={0}
            max={seekDuration}
            step={1}
            value={seekerPreview ?? currentPosition}
            onChange={e => setSeekerPreview(Number(e.target.value))}
            onMouseUp={() => {
              const pos = seekerPreview ?? currentPosition;
              handleSeek(pos);
            }}
            onTouchEnd={() => {
              const pos = seekerPreview ?? currentPosition;
              handleSeek(pos);
            }}
            aria-label='Seek position'
          />
          <span className='sonos-seeker-time' aria-hidden='true'>
            {formatTime(seekDuration)}
          </span>
        </div>
      )}

      {/* Volume Row */}
      <div className='sonos-volume-row'>
        <button className='sonos-btn-icon' onClick={handleMuteToggle}>
          <Icon icon={isMuted ? 'mdi:volume-off' : volume > 50 ? 'mdi:volume-high' : 'mdi:volume-medium'} />
        </button>
        <div className='sonos-volume-buttons'>
          <button className='sonos-btn-sm' onClick={() => handleVolumeStep(-5)} title='Volume down'>
            <Icon icon='mdi:minus' />
          </button>
          <span className='sonos-volume-value'>{volumeUi}%</span>
          <button className='sonos-btn-sm' onClick={() => handleVolumeStep(5)} title='Volume up'>
            <Icon icon='mdi:plus' />
          </button>
        </div>

        {/* Group button (opens modal) */}
        <button
          className={`sonos-btn-icon group ${hasGroup ? 'active' : ''}`}
          onClick={() => setShowGroupModal(true)}
          title='Group speakers'
        >
          <Icon icon='mdi:speaker-multiple' />
          {hasGroup && <span className='group-badge'>{groupMembers.length}</span>}
        </button>
      </div>

      {/* Volume Mixer (if grouped) */}
      {hasGroup && (
        <button className={`sonos-mixer-toggle ${showVolumeMixer ? 'active' : ''}`} onClick={() => setShowVolumeMixer(!showVolumeMixer)}>
          <Icon icon='mdi:tune-vertical' />
          <span>Adjust volumes ({groupMembers.length})</span>
          <Icon icon={showVolumeMixer ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </button>
      )}

      {hasGroup && showVolumeMixer && (
        <div className='sonos-volume-mixer'>
          {groupedSpeakers.map(speaker => (
            <div key={speaker.id} className={`sonos-mixer-item ${speaker.isMaster ? 'master' : ''}`}>
              <span className='mixer-speaker-name'>
                {speaker.isMaster && <Icon icon='mdi:crown' className='master-icon' />}
                {speaker.name}
              </span>
              <div className='sonos-mixer-controls'>
                <button className='sonos-btn-xs' onClick={() => handleMixerVolumeStep(speaker.id, -5)} title='Volume down'>
                  <Icon icon='mdi:minus' />
                </button>
                <span className='sonos-volume-value'>{mixerVolumes[speaker.id] ?? speaker.volume}%</span>
                <button className='sonos-btn-xs' onClick={() => handleMixerVolumeStep(speaker.id, 5)} title='Volume up'>
                  <Icon icon='mdi:plus' />
                </button>
                <button
                  className={`sonos-btn-xs sonos-mixer-mute ${speaker.isMuted ? 'muted' : ''}`}
                  onClick={() => handleMixerMuteToggle(speaker.id)}
                  title={speaker.isMuted ? 'Unmute' : 'Mute'}
                >
                  <Icon icon={speaker.isMuted ? 'mdi:volume-off' : 'mdi:volume-high'} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Source Picker Toggle */}
      <button
        className={`sonos-source-toggle ${showSourcePicker ? 'active' : ''} ${isSpotify ? 'is-spotify' : ''} ${isAirPlay ? 'is-airplay' : ''} ${isLineIn(currentSource) ? 'is-audiocast' : ''} ${isTVSource ? 'is-tv' : ''}`}
        onClick={() => setShowSourcePicker(!showSourcePicker)}
      >
        {isSpotify ? (
          <Icon icon='mdi:spotify' className='spotify-icon' />
        ) : isTVSource ? (
          <Icon icon='mdi:television' />
        ) : isAirPlay ? (
          <Icon icon='mdi:airplay' className='airplay-icon' />
        ) : isLineIn(currentSource) ? (
          <Icon icon='mdi:cast' className='cast-icon' />
        ) : currentRadio?.logo ? (
          <img src={currentRadio.logo} alt='' className='source-logo' />
        ) : (
          <Icon icon='mdi:radio' />
        )}
        <span>{displaySource}</span>
        <Icon icon={showSourcePicker ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
      </button>

      {/* Combined Source Picker */}
      {showSourcePicker && (
        <div className='sonos-source-panel'>
          {/* Spotify Link */}
          <button className={`sonos-source-item spotify ${isSpotify ? 'active' : ''}`} onClick={handleSpotifyClick}>
            <Icon icon='mdi:spotify' />
            <span>Open Spotify</span>
            <Icon icon='mdi:open-in-new' className='external' />
          </button>

          {/* Radio Stations */}
          {RADIO_STATIONS.length > 0 && (
            <div className='source-section'>
              <span className='source-section-label'>Radio</span>
              <div className='source-grid'>
                {RADIO_STATIONS.map(station => (
                  <button
                    key={station.id}
                    className={`source-grid-item ${currentRadio?.id === station.id ? 'active' : ''}`}
                    onClick={() => handlePlayRadio(station.id)}
                    style={station.color ? ({ '--station-color': station.color } as React.CSSProperties) : undefined}
                  >
                    {station.logo ? <img src={station.logo} alt={station.name} /> : <Icon icon={station.icon || 'mdi:radio'} />}
                    <span>{station.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Podcasts */}
          {PODCAST_FEEDS.length > 0 && (
            <div className='source-section'>
              <span className='source-section-label'>Podcasts</span>
              <button
                className='sonos-source-item'
                onClick={() => {
                  podcastModalOpenedAt.current = Date.now();
                  setShowPodcastModal(true);
                  setViewingEpisodes(false);
                  setSelectedPodcastId(null);
                  try {
                    window.history.pushState({ podcastModal: true, viewingEpisodes: false }, '', window.location.pathname);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <Icon icon='mdi:podcast' />
                <span>Browse podcasts</span>
                <Icon icon='mdi:chevron-right' />
              </button>
            </div>
          )}

          {/* Input Sources */}
          {sourceList.filter(source => {
            // Hide "Music Assistant Queue" as it's the default
            const sourceLower = source.toLowerCase();
            return !sourceLower.includes('music assistant queue') && !sourceLower.includes('music assistant');
          }).length > 0 && (
            <div className='source-section'>
              <span className='source-section-label'>Inputs</span>
              {sourceList
                .filter(source => {
                  const sourceLower = source.toLowerCase();
                  // Hide Music Assistant Queue (default)
                  if (sourceLower.includes('music assistant queue') || sourceLower.includes('music assistant')) return false;
                  // Hide AirPlay – it's native to Sonos, shown only when active in the source toggle, not selectable here
                  if (isAirPlaySource(source)) return false;
                  return true;
                })
                .map(source => {
                  // Determine icon based on source type
                  let iconName = 'mdi:audio-input-stereo-minijack';
                  if (isLineIn(source)) {
                    iconName = 'mdi:cast';
                  } else if (isAirPlaySource(source)) {
                    iconName = 'mdi:airplay';
                  } else if (isTVSourceName(source)) {
                    iconName = 'mdi:television';
                  }

                  return (
                    <button
                      key={source}
                      className={`sonos-source-item ${source === currentSource ? 'active' : ''} ${isLineIn(source) ? 'audiocast' : ''} ${isAirPlaySource(source) ? 'airplay' : ''}`}
                      onClick={() => handleSelectSource(source)}
                    >
                      <Icon icon={iconName} />
                      <span>{getSourceDisplayName(source)}</span>
                      {source === currentSource && <Icon icon='mdi:check' className='check' />}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Group Modal - swipe/tap on overlay closes modal, stopPropagation prevents RoomDetail closing */}
      {showGroupModal && (
        <div
          className='sonos-modal-overlay'
          onClick={closeGroupModal}
          onTouchStart={handleModalTouchStart}
          onTouchMove={handleModalTouchMove}
          onTouchEnd={handleModalTouchEnd}
        >
          <div className='sonos-modal' onClick={e => e.stopPropagation()}>
            <div className='sonos-modal-header'>
              <h3>Group Speakers</h3>
              <button className='modal-close modal-close-button' onClick={closeGroupModal}>
                <Icon icon='mdi:close' />
              </button>
            </div>

            <div className='sonos-modal-content'>
              {/* Current group - click any speaker to remove it */}
              {hasGroup && (
                <div className='group-section'>
                  <span className='group-section-label'>Currently playing together (tap to remove)</span>
                  {sortedGroupMembers.map(memberId => {
                    const speaker = SONOS_SPEAKERS.find(s => s.id === memberId);
                    const isThis = memberId === entityId;
                    const isMaster = memberId === masterId;
                    let label = speaker?.name || memberId;
                    if (isMaster && isThis) {
                      label += ' (master, this)';
                    } else if (isMaster) {
                      label += ' (master)';
                    } else if (isThis) {
                      label += ' (this)';
                    }
                    return (
                      <button
                        key={memberId}
                        className='group-speaker active'
                        onClick={() => handleRemoveFromGroup(memberId)}
                        title={`Remove ${speaker?.name || memberId} from group`}
                      >
                        <Icon icon='mdi:speaker' />
                        <span>{label}</span>
                        <Icon icon='mdi:check' className='check' />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Available speakers */}
              {otherSpeakers.length > 0 && (
                <div className='group-section'>
                  <span className='group-section-label'>Available speakers</span>
                  {otherSpeakers.map(speaker => {
                    const speakerEntity = entities?.[speaker.id];
                    const speakerState = speakerEntity?.state || 'unavailable';
                    const isAvailable = speakerState !== 'unavailable';
                    // Check if speaker is in another group - use helper to robustly determine master
                    const rawSpeakerMembers = speakerEntity?.attributes?.group_members;
                    const speakerGroupMembers: string[] = Array.isArray(rawSpeakerMembers)
                      ? rawSpeakerMembers.filter((id): id is string => typeof id === 'string' && id.length > 0)
                      : [speaker.id];
                    const isInAnotherGroup = speakerGroupMembers.length > 1;
                    const otherGroupMaster = isInAnotherGroup ? getMasterFromEntity(speakerEntity, speaker.id) : null;
                    const otherGroupMasterName = otherGroupMaster
                      ? SONOS_SPEAKERS.find(s => s.id === otherGroupMaster)?.name || 'another group'
                      : '';

                    let statusText = speakerState;
                    if (isInAnotherGroup) {
                      statusText = `grouped with ${otherGroupMasterName}`;
                    }

                    // Click action: if in another group → unjoin, otherwise → join
                    const handleClick = () => {
                      if (!isAvailable) return;
                      if (isInAnotherGroup) {
                        // Unjoin from other group - will become available
                        handleRemoveFromGroup(speaker.id);
                      } else {
                        // Join this group
                        handleJoinGroup(speaker.id);
                      }
                    };

                    return (
                      <button
                        key={speaker.id}
                        className={`group-speaker ${!isAvailable ? 'unavailable' : ''} ${isInAnotherGroup ? 'in-group' : ''}`}
                        onClick={handleClick}
                        disabled={!isAvailable}
                        title={isInAnotherGroup ? `Tap to ungroup from ${otherGroupMasterName}` : `Tap to add to group`}
                      >
                        <Icon icon={isInAnotherGroup ? 'mdi:speaker-multiple' : 'mdi:speaker'} />
                        <span>{speaker.name}</span>
                        <span className='speaker-status'>{statusText}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Podcast Modal */}
      {showPodcastModal && (
        <div
          className='sonos-modal-overlay'
          onClick={handleClosePodcastModal}
          onTouchStart={handlePodcastTouchStart}
          onTouchMove={handlePodcastTouchMove}
          onTouchEnd={handlePodcastTouchEnd}
        >
          <div className='sonos-modal large' onClick={e => e.stopPropagation()}>
            <div className='sonos-modal-header'>
              {viewingEpisodes ? (
                <>
                  <button className='modal-back' onClick={handleBackToPodcasts}>
                    <Icon icon='mdi:arrow-left' />
                  </button>
                  <h3>{PODCAST_FEEDS.find(f => f.id === selectedPodcastId)?.title || 'Episodes'}</h3>
                </>
              ) : (
                <h3>Podcasts</h3>
              )}
              <button className='modal-close modal-close-button' onClick={handleClosePodcastModal}>
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='sonos-modal-content'>
              {!viewingEpisodes ? (
                // Podcast list view
                <div className='podcast-modal-list'>
                  {[...PODCAST_FEEDS]
                    .sort((a, b) => a.title.localeCompare(b.title, 'da'))
                    .map(feed => (
                      <button key={feed.id} className='podcast-row' onClick={() => handleSelectPodcast(feed.id)}>
                        {feed.cover ? <img src={feed.cover} alt={feed.title} className='podcast-cover' /> : <Icon icon='mdi:podcast' />}
                        <div className='podcast-row-text'>
                          <span className='podcast-row-title'>{feed.title}</span>
                        </div>
                        <Icon icon='mdi:chevron-right' />
                      </button>
                    ))}
                </div>
              ) : (
                // Episode list view
                <>
                  {podcastError && <div className='podcast-error'>{podcastError}</div>}
                  <div className='podcast-modal-list'>
                    {podcastLoading === selectedPodcastId ? (
                      <div className='sonos-empty'>Loading episodes...</div>
                    ) : selectedPodcastId && podcastEpisodes[selectedPodcastId] && podcastEpisodes[selectedPodcastId].length > 0 ? (
                      podcastEpisodes[selectedPodcastId].map((ep: { title: string; url: string; pubDate?: string }) => (
                        <button
                          key={ep.url}
                          className='podcast-row'
                          onClick={() => {
                            if (!callService) return;
                            callService({
                              domain: 'media_player',
                              service: 'play_media',
                              target: { entity_id: entityId },
                              serviceData: {
                                media_content_id: ep.url,
                                media_content_type: 'audio/mpeg',
                              },
                            });
                            handleClosePodcastModal();
                            setShowSourcePicker(false);
                          }}
                        >
                          <Icon icon='mdi:play-circle' />
                          <div className='podcast-row-text'>
                            <span className='podcast-row-title'>{ep.title}</span>
                            {ep.pubDate && <span className='podcast-row-sub'>{ep.pubDate}</span>}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className='sonos-empty'>No episodes found</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
