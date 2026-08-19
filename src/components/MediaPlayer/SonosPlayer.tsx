import { useState, useEffect, useMemo, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { SonosPlayerProps } from '../../types';
import { SONOS_SPEAKERS } from '../../config/speakers';
import { RADIO_STATIONS } from '../../config/radio';
import { PODCAST_FEEDS } from '../../config/podcasts';
import { AUDIOCAST_STREAM_URI, rawSonosEntityId } from '../../config/audiocast';
import { isMediaPlayerOutOfSync } from '../../utils/mediaPlayer';
import { getAccessibleHistoryWindow, getHistoryUrl } from '../../utils/navigation';
import { useLocalStorageBoolean, useModalBackButton, useSwipeToClose, useTouchScrollSlopGuard } from '../../hooks';
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

/**
 * MA players use the clean id (media_player.kitchen); the native Sonos twins carry a
 * `_2` suffix (media_player.kitchen_2). group_members always match the flavor of the
 * entity they came from, so names/membership must compare BASE ids while service calls
 * must target the ACTUAL (flavored) ids.
 */
const baseEntityId = (id: string): string => (id.endsWith('_2') ? id.slice(0, -2) : id);

/** pushState/replaceState must keep #room=… or Dashboard hash sync closes the room (iframe / rooftop). */
function podcastHistoryUrl(): string {
  return getHistoryUrl();
}

function withHistoryWindow(action: (targetWindow: Window) => void) {
  const targetWindow = getAccessibleHistoryWindow();
  if (!targetWindow) return;
  action(targetWindow);
}

/** `embedded` = render the expanded face bare (the QuickAccess media modal supplies its own
 *  chrome and title); the room-detail home gets the collapsible card. */
interface SonosCardProps extends SonosPlayerProps {
  embedded?: boolean;
  /** Rooftop only: input_boolean exempting this speaker from follow-me muting while docked. */
  keepPlayingEntityId?: string;
  /** Rooftop only: binary_sensor that is on while the speaker sits in its charging dock. */
  dockedEntityId?: string;
}

export function SonosPlayer({
  entityId,
  entities,
  hassUrl,
  callService,
  embedded = false,
  keepPlayingEntityId,
  dockedEntityId,
}: SonosCardProps) {
  // Collapsed by default in the room-detail home (same pattern as TonightCard/HeatCard).
  const [collapsed, setCollapsed] = useLocalStorageBoolean('sonoscard-collapsed', true);
  const topSlop = useTouchScrollSlopGuard();
  const [showGroupModal, setShowGroupModal] = useState(false);
  // The Source sheet: one pop-up with three faces - the source grid, the podcast feed list,
  // and a feed's episodes. Same manual back/history machinery the podcast modal always used.
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const sourceSheetOpenedAt = useRef<number>(0);
  const sourcePendingOpenRef = useRef(false);
  const showSourcePickerRef = useRef(false);
  const [imageError, setImageError] = useState(false);
  const [volumeUi, setVolumeUi] = useState(0);
  // Apple-style picker: optimistic membership per speaker. Shown while it differs from the
  // entity's actual group state, ignored once HA converges (derive-during-render, no effects).
  const [pendingGroup, setPendingGroup] = useState<Record<string, boolean>>({});
  // Local slider values for the picker (slider owns its value once touched, like the mixer)
  const [pickerVolumes, setPickerVolumes] = useState<Record<string, number>>({});
  const [podcastEpisodes, setPodcastEpisodes] = useState<Record<string, Array<{ title: string; url: string; pubDate?: string }>>>({});
  const [podcastLoading, setPodcastLoading] = useState<string | null>(null);
  const [podcastError, setPodcastError] = useState<string | null>(null);
  const [showPodcastModal, setShowPodcastModal] = useState(false);
  const podcastModalOpenedAt = useRef<number>(0);
  /** Set synchronously on open so modalBackButton beats React re-render (embed/spurious popstate). */
  const podcastPendingOpenRef = useRef(false);
  const showPodcastModalRef = useRef(false);
  const viewingEpisodesRef = useRef(false);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string | null>(null);
  const [viewingEpisodes, setViewingEpisodes] = useState(false);
  const [volumeDragging, setVolumeDragging] = useState(false);
  const [seekerPreview, setSeekerPreview] = useState<number | null>(null); // position in seconds while dragging
  const [, setSeekerTick] = useState(0); // force re-render for live position when playing
  const player = entities?.[entityId];

  // Rooftop: docked (charging), follow-me mutes this speaker when the living room is
  // empty; off the dock it always plays (follow_me.py _is_present). The switch is named
  // for the one case it changes.
  const keepPlaying = keepPlayingEntityId ? entities?.[keepPlayingEntityId] : undefined;
  const keepPlayingOn = keepPlaying?.state === 'on';
  const dockedNow = dockedEntityId ? entities?.[dockedEntityId]?.state === 'on' : false;
  const toggleKeepPlaying = () => {
    if (!callService || !keepPlayingEntityId) return;
    callService({
      domain: 'input_boolean',
      service: keepPlayingOn ? 'turn_off' : 'turn_on',
      target: { entity_id: keepPlayingEntityId },
    });
  };

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

  // Resolve any id flavor to the configured display name; last resort = friendly_name.
  const speakerNameFor = (id: string): string => {
    const cfg = SONOS_SPEAKERS.find(s => s.id === baseEntityId(id));
    if (cfg) return cfg.name;
    const fn = entities?.[id]?.attributes?.friendly_name;
    return typeof fn === 'string' && fn ? fn : id.split('.')[1] || id;
  };
  // Map a config (base) speaker id to the id actually used in this player's group flavor.
  const idFlavor = entityId.endsWith('_2') ? '_2' : '';
  const actualIdFor = (configId: string): string => groupMembers.find(m => baseEntityId(m) === configId) ?? `${configId}${idFlavor}`;
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

  const isOutOfSync = isMediaPlayerOutOfSync(entities, entityId);

  const groupedSpeakers = useMemo(() => {
    const speakers = groupMembers.map((id, index) => {
      const speaker = SONOS_SPEAKERS.find(s => s.id === baseEntityId(id));
      const entity = entities?.[id];
      return {
        id,
        name:
          speaker?.name || (typeof entity?.attributes?.friendly_name === 'string' && entity.attributes.friendly_name) || id.split('.')[1],
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
    if (volumeDragging) return;
    setVolumeUi(volume);
  }, [volume, volumeDragging]);

  // Close group modal
  const closeGroupModal = () => {
    setShowGroupModal(false);
  };

  const { requestClose: requestCloseGroupModal } = useModalBackButton({
    isOpen: showGroupModal,
    onRequestClose: closeGroupModal,
    historyKey: 'sonos-group-modal',
  });

  // Registering the Source sheet on the shared modal stack is what stops an enclosing modal
  // (QuickAccess Media) from ALSO handling the same back press. The level-flipping itself is
  // done by the manual modalBackButton listener below, so this close handler is a no-op.
  useModalBackButton({
    isOpen: showSourcePicker || showPodcastModal,
    onRequestClose: () => {},
    historyKey: 'sonos-source-sheet',
  });

  // Use standardized swipe-to-close hook for group modal
  const {
    handleTouchStart: handleModalTouchStart,
    handleTouchMove: handleModalTouchMove,
    handleTouchEnd: handleModalTouchEnd,
  } = useSwipeToClose(requestCloseGroupModal);

  useEffect(() => {
    showPodcastModalRef.current = showPodcastModal;
    if (showPodcastModal) podcastPendingOpenRef.current = false;
  }, [showPodcastModal]);

  useEffect(() => {
    showSourcePickerRef.current = showSourcePicker;
    if (showSourcePicker) sourcePendingOpenRef.current = false;
  }, [showSourcePicker]);

  useEffect(() => {
    viewingEpisodesRef.current = viewingEpisodes;
  }, [viewingEpisodes]);

  // Same pattern as group modal + WeatherCard: Dashboard popstate runs first; without preventDefault
  // the room unmounts (feels like the podcast pop-up “closes”). Refs cover the frame before showPodcastModal commits.
  useEffect(() => {
    const handleModalBack = (e: Event) => {
      const sheetOpen =
        showSourcePickerRef.current || sourcePendingOpenRef.current || showPodcastModalRef.current || podcastPendingOpenRef.current;
      if (!sheetOpen) return;

      e.preventDefault();

      const msSinceOpen = Date.now() - Math.max(podcastModalOpenedAt.current, sourceSheetOpenedAt.current);
      if (podcastPendingOpenRef.current || sourcePendingOpenRef.current || msSinceOpen < 500) {
        return;
      }

      if (viewingEpisodesRef.current) {
        setViewingEpisodes(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ podcastModal: true, viewingEpisodes: false }, '', podcastHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      } else if (showPodcastModalRef.current) {
        // Podcasts page flips back to the source grid; the sheet itself stays open.
        setShowPodcastModal(false);
        setSelectedPodcastId(null);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ podcastModal: null }, '', podcastHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      } else {
        setShowSourcePicker(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ sourceSheet: null }, '', podcastHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      }
    };

    window.addEventListener('modalBackButton', handleModalBack);
    return () => window.removeEventListener('modalBackButton', handleModalBack);
  }, []);

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

  // Inputs shown in the picker. Drop the MA queue (default), AirPlay (native, not
  // selectable) and any line-in entry — Audiocast is synthesized for every room
  // instead, since x-rincon-stream playback works regardless of a room's own
  // source_list (e.g. the Arc Ultra never advertises Line-in).
  const inputSources = sourceList.filter(source => {
    const sourceLower = source.toLowerCase();
    if (sourceLower.includes('music assistant queue') || sourceLower.includes('music assistant')) return false;
    if (isAirPlaySource(source)) return false;
    if (isLineIn(source)) return false;
    return true;
  });

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

  // Steps every current member together. Basing each step on pickerVolumes (not raw entity
  // state) is what makes rapid taps accumulate instead of re-reading stale HA state.
  // Muted members are left alone: volume_set un-mutes them downstream, and a muted
  // speaker in a group is meant to stay silent through group nudges.
  const handleGroupVolumeStep = (direction: 1 | -1) => {
    if (!callService) return;
    const updates: Record<string, number> = {};
    pickerSpeakers.forEach(sp => {
      const pend = pendingGroup[sp.id];
      const inFlight = pend !== undefined && pend !== sp.isMember;
      const shownIn = inFlight ? pend : sp.isMember;
      if (!shownIn || !sp.available || sp.isMuted) return;
      const base = pickerVolumes[sp.id] ?? sp.volume;
      const next = Math.max(0, Math.min(100, base + direction * 5));
      updates[sp.id] = next;
      handleVolumeChange(sp.actualId, next);
    });
    setPickerVolumes(prev => ({ ...prev, ...updates }));
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
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;

    const handlePopState = (event: PopStateEvent) => {
      if (!showPodcastModal && !showSourcePicker) return;
      event.stopImmediatePropagation();
      if (showPodcastModal && viewingEpisodes) {
        // Go back to podcast list
        setViewingEpisodes(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ podcastModal: true, viewingEpisodes: false }, '', podcastHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      } else if (showPodcastModal) {
        // Podcasts page flips back to the source grid; the sheet itself stays open.
        setShowPodcastModal(false);
        setSelectedPodcastId(null);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ podcastModal: null }, '', podcastHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      } else {
        setShowSourcePicker(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ sourceSheet: null }, '', podcastHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      }
    };
    targetWindow.addEventListener('popstate', handlePopState, { capture: true });
    return () => targetWindow.removeEventListener('popstate', handlePopState, { capture: true });
  }, [showPodcastModal, showSourcePicker, viewingEpisodes]);

  // Custom swipe handler for the source sheet (needs special logic for back navigation)
  const handlePodcastSwipe = () => {
    if (viewingEpisodes) {
      setViewingEpisodes(false);
      try {
        withHistoryWindow(targetWindow => {
          targetWindow.history.replaceState({ podcastModal: true, viewingEpisodes: false }, '', podcastHistoryUrl());
        });
      } catch {
        /* ignore */
      }
    } else if (showPodcastModal) {
      handleClosePodcastModal();
    } else {
      handleCloseSourceSheet();
    }
  };

  // Use standardized swipe-to-close hook for the source sheet
  const {
    handleTouchStart: handlePodcastTouchStart,
    handleTouchMove: handlePodcastTouchMove,
    handleTouchEnd: handlePodcastTouchEnd,
  } = useSwipeToClose(handlePodcastSwipe);

  const handleOpenSourceSheet = () => {
    sourceSheetOpenedAt.current = Date.now();
    sourcePendingOpenRef.current = true;
    // useModalBackButton pushes the sheet's history entry when isOpen flips.
    setShowSourcePicker(true);
  };

  /** Overlay taps only: swallows the ghost click the opening tap can produce (500ms, as elsewhere). */
  const handleOverlayCloseSourceSheet = () => {
    if (Date.now() - sourceSheetOpenedAt.current < 500) return;
    handleCloseSourceSheet();
  };

  const handleCloseSourceSheet = () => {
    sourcePendingOpenRef.current = false;
    setShowSourcePicker(false);
    setShowPodcastModal(false);
    setViewingEpisodes(false);
    setSelectedPodcastId(null);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.replaceState({ sourceSheet: null }, '', podcastHistoryUrl());
      });
    } catch {
      /* ignore */
    }
  };

  const handleOpenPodcastsPage = () => {
    podcastModalOpenedAt.current = Date.now();
    podcastPendingOpenRef.current = true;
    setShowPodcastModal(true);
    setViewingEpisodes(false);
    setSelectedPodcastId(null);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.pushState({ podcastModal: true, viewingEpisodes: false }, '', podcastHistoryUrl());
      });
    } catch {
      /* ignore */
    }
  };

  /** Flips the Podcasts page away; the Source sheet underneath stays open. */
  const flipBackToSourceGrid = () => {
    podcastPendingOpenRef.current = false;
    setShowPodcastModal(false);
    setViewingEpisodes(false);
    setSelectedPodcastId(null);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.replaceState({ podcastModal: null }, '', podcastHistoryUrl());
      });
    } catch {
      /* ignore */
    }
  };

  const handleClosePodcastModal = () => {
    // Ignore overlay click right after open (WeatherCard uses 500ms; touch ghost clicks)
    const now = Date.now();
    if (now - podcastModalOpenedAt.current < 500) return;
    flipBackToSourceGrid();
  };

  const handleSelectPodcast = (feedId: string) => {
    setSelectedPodcastId(feedId);
    setViewingEpisodes(true);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.pushState({ podcastModal: true, viewingEpisodes: true, feedId }, '', podcastHistoryUrl());
      });
    } catch {
      /* ignore */
    }
  };

  const handleBackToPodcasts = () => {
    setViewingEpisodes(false);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.replaceState({ podcastModal: true, viewingEpisodes: false }, '', podcastHistoryUrl());
      });
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
    handleCloseSourceSheet();
  };

  const handleSelectSource = (source: string) => {
    if (!callService) return;
    if (isLineIn(source)) {
      // Audiocast: pull the line-in host's feed onto this room. Must target the raw
      // Sonos entity — x-rincon-stream is a Sonos-native URI Music Assistant can't play.
      callService({
        domain: 'media_player',
        service: 'play_media',
        target: { entity_id: rawSonosEntityId(baseEntityId(entityId)) },
        serviceData: {
          media_content_id: AUDIOCAST_STREAM_URI,
          media_content_type: 'music',
        },
      });
    } else {
      callService({
        domain: 'media_player',
        service: 'select_source',
        target: { entity_id: entityId },
        serviceData: { source },
      });
    }
    handleCloseSourceSheet();
  };

  // Apple AirPlay model: ONE list, tap a row to toggle that speaker in/out of THIS group.
  // Checking a speaker always pulls it into this group (HA join moves it out of any other
  // group in the same call); unchecking always unjoins it. No two-step ungroup-then-add.
  const handleToggleSpeaker = (speakerId: string) => {
    if (!callService) return;
    const actualId = actualIdFor(speakerId);
    const isMember = groupMembers.some(m => baseEntityId(m) === speakerId);
    setPendingGroup(prev => ({ ...prev, [speakerId]: !isMember }));
    if (isMember) {
      callService({ domain: 'media_player', service: 'unjoin', target: { entity_id: actualId } });
    } else {
      callService({
        domain: 'media_player',
        service: 'join',
        target: { entity_id: masterId },
        serviceData: { group_members: [actualId] },
      });
    }
  };

  const handleSpeakerMuteToggle = (speakerId: string) => {
    if (!callService) return;
    const muted = Boolean(entities?.[speakerId]?.attributes?.is_volume_muted);
    callService({
      domain: 'media_player',
      service: 'volume_mute',
      target: { entity_id: speakerId },
      serviceData: { is_volume_muted: !muted },
    });
  };

  // Unified picker rows: members first (master on top), then the rest alphabetically.
  // All comparisons use BASE ids (MA/native `_2` flavors), service targets use actual ids.
  const pickerSpeakers = useMemo(() => {
    const rows = SONOS_SPEAKERS.map(speaker => {
      const isMember = groupMembers.some(m => baseEntityId(m) === speaker.id);
      const actualId = groupMembers.find(m => baseEntityId(m) === speaker.id) ?? `${speaker.id}${idFlavor}`;
      const ent = entities?.[actualId] ?? entities?.[speaker.id];
      const entState = ent?.state || 'unavailable';
      const rawMembers = ent?.attributes?.group_members;
      const members: string[] = Array.isArray(rawMembers)
        ? rawMembers.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [speaker.id];
      const inOtherGroup = !isMember && members.length > 1;
      const otherMaster = inOtherGroup ? getMasterFromEntity(ent ?? null, speaker.id) : null;
      return {
        id: speaker.id,
        actualId,
        name: speaker.name,
        available: entState !== 'unavailable' && entState !== 'unknown',
        isMember,
        isMaster: isMember && baseEntityId(masterId) === speaker.id,
        isThis: speaker.id === baseEntityId(entityId),
        playingTitle: entState === 'playing' ? String(ent?.attributes?.media_title || '') : '',
        otherMasterName: otherMaster ? speakerNameFor(otherMaster) : '',
        volume: Math.round((Number(ent?.attributes?.volume_level) || 0) * 100),
        isMuted: Boolean(ent?.attributes?.is_volume_muted),
      };
    });
    return rows.sort((a, b) => {
      if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
      if (a.isMember && b.isMember && a.isMaster !== b.isMaster) return a.isMaster ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    // speakerNameFor/actualIdFor derive from entities+groupMembers+idFlavor already in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, groupMembers, masterId, entityId, idFlavor]);

  if (!player) return <div className='sonos-card'>Speaker not found</div>;

  // The state word compresses the whole card; green while something is actually playing.
  const stateWord = isPlaying ? `Playing · ${groupMembers.length}` : state === 'paused' ? 'Paused' : 'Quiet';
  const otherMemberNames = groupedSpeakers.filter(s => !s.isMaster).map(s => s.name);
  const subtitleParts = [mediaArtist, displaySource !== 'Select source' ? displaySource : ''].filter(Boolean);
  const volumePct = Math.max(0, Math.min(100, volumeUi));
  const seekPct = seekDuration > 0 ? Math.max(0, Math.min(100, ((seekerPreview ?? currentPosition) / seekDuration) * 100)) : 0;

  // The source door wears the CURRENT source's mark - brands as logos, everything else as a glyph.
  const sourceMark = isSpotify ? (
    <Icon icon='mdi:spotify' className='sonos-mark--spotify' aria-hidden='true' />
  ) : currentRadio?.logo ? (
    <img src={currentRadio.logo} alt='' className='sonos-mark-logo' />
  ) : isTVSource ? (
    <Icon icon='mdi:television' className='sonos-mark--tv' aria-hidden='true' />
  ) : isAirPlay ? (
    <Icon icon='mdi:airplay' aria-hidden='true' />
  ) : isLineIn(currentSource) ? (
    <Icon icon='mdi:cast' aria-hidden='true' />
  ) : isPodcast ? (
    <Icon icon='mdi:podcast' aria-hidden='true' />
  ) : (
    <Icon icon='mdi:music' aria-hidden='true' />
  );

  // Inputs: the TV tile takes the first TV-ish entry (or the only input there is); everything
  // else from today's Inputs list survives as a chip under the grid.
  const tvSource = inputSources.find(isTVSourceName) ?? inputSources[0];
  const otherInputSources = inputSources.filter(s => s !== tvSource);

  // Group volume row only earns its place once there are 2+ members actually shown in the group.
  const groupVolumeEligibleCount = pickerSpeakers.filter(sp => {
    const pend = pendingGroup[sp.id];
    const inFlight = pend !== undefined && pend !== sp.isMember;
    const shownIn = inFlight ? pend : sp.isMember;
    return shownIn && sp.available;
  }).length;

  const face = (
    <>
      {/* Now playing */}
      <div className='sonos-now'>
        <div className='sonos-art'>
          {showImage ? (
            <img src={safeImage || ''} alt='' onError={() => setImageError(true)} />
          ) : (
            <div className='sonos-art-placeholder'>
              <Icon icon={isLineIn(currentSource) ? 'mdi:cast' : 'mdi:music'} aria-hidden='true' />
            </div>
          )}
        </div>
        <div className='sonos-track'>
          <div className='sonos-track-title'>{displayTitle}</div>
          {subtitleParts.length > 0 && <div className='sonos-track-sub'>{subtitleParts.join(' · ')}</div>}
          {hasGroup && masterSpeakerName && (
            <div className='sonos-leader'>
              <Icon icon='mdi:crown' aria-hidden='true' />
              {[masterSpeakerName, ...otherMemberNames].join(' · ')}
            </div>
          )}
        </div>
      </div>

      {/* Transport */}
      <div className='sonos-transport'>
        <button type='button' className='sonos-tbtn' onClick={handlePrevious} aria-label='Previous track'>
          <Icon icon='mdi:skip-previous' aria-hidden='true' />
        </button>
        <button
          className='sonos-tbtn sonos-tbtn--main'
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            handlePlayPause();
          }}
          type='button'
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          <Icon icon={isPlaying ? 'mdi:pause' : 'mdi:play'} aria-hidden='true' />
        </button>
        <button type='button' className='sonos-tbtn' onClick={handleNext} aria-label='Next track'>
          <Icon icon='mdi:skip-next' aria-hidden='true' />
        </button>
      </div>

      {/* Seek – only for seekable content (not radio, not audiocast) */}
      {showSeeker && seekDuration > 0 && (
        <div className='sonos-seek'>
          <div className='sonos-strip sonos-strip--thin'>
            <div className='sonos-strip-fill' style={{ width: `${seekPct}%` }} />
            <input
              type='range'
              className='sonos-strip-input'
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
          </div>
          <div className='sonos-seek-times'>
            <span>{formatTime(currentPosition)}</span>
            <span>{formatTime(seekDuration)}</span>
          </div>
        </div>
      )}

      {/* Volume */}
      <div className='sonos-volume'>
        <button type='button' className='sonos-mute' onClick={handleMuteToggle} aria-label={isMuted ? 'Unmute' : 'Mute'}>
          <Icon icon={isMuted ? 'mdi:volume-off' : volume > 50 ? 'mdi:volume-high' : 'mdi:volume-medium'} aria-hidden='true' />
        </button>
        <div className='sonos-strip'>
          <div className='sonos-strip-fill' style={{ width: `${volumePct}%` }} />
          <input
            type='range'
            className='sonos-strip-input'
            min={0}
            max={100}
            step={1}
            value={volumeUi}
            onChange={e => {
              setVolumeDragging(true);
              setVolumeUi(Number(e.target.value));
            }}
            onMouseUp={() => {
              handleVolumeChange(entityId, volumeUi);
              setVolumeDragging(false);
            }}
            onTouchEnd={() => {
              handleVolumeChange(entityId, volumeUi);
              setVolumeDragging(false);
            }}
            aria-label='Volume'
          />
        </div>
        <span className='sonos-volume-value'>{volumeUi}%</span>
      </div>

      {/* Doors */}
      <div className='sonos-doors'>
        <button
          type='button'
          className='sonos-ibtn'
          onClick={() => {
            // Reopen shows current HA volumes, not values dragged in a previous session.
            setPickerVolumes({});
            setShowGroupModal(true);
          }}
          aria-label='Speakers'
          title='Speakers'
        >
          <Icon icon='mdi:speaker-multiple' aria-hidden='true' />
          {hasGroup && <span className='sonos-badge'>{groupMembers.length}</span>}
        </button>
        <button
          type='button'
          className='sonos-ibtn sonos-ibtn--bare'
          onClick={handleOpenSourceSheet}
          aria-label='Source'
          title={displaySource}
        >
          {sourceMark}
        </button>
      </div>

      {/* Keep playing while docked - the standalone RoomDetail toggle folded into this
          card (user 2026-08-07), same row grammar as LightCard's "Automatic lighting". */}
      {keepPlaying && (
        <div
          className='sonos-keep-row'
          role='switch'
          tabIndex={0}
          aria-checked={keepPlayingOn}
          onClick={toggleKeepPlaying}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleKeepPlaying();
            }
          }}
          title='Docked, the speaker mutes when the living room is empty. Off the dock it always plays.'
        >
          <span className='sonos-keep-text'>
            <span className='sonos-keep-name'>Keep playing while docked</span>
            {dockedNow && (
              <span className='sonos-keep-sub'>
                {keepPlayingOn ? 'Docked now — staying on' : 'Docked now — mutes when the living room empties'}
              </span>
            )}
          </span>
          <span className={`sonos-keep-knob ${keepPlayingOn ? 'on' : ''}`} aria-hidden='true' />
        </div>
      )}
    </>
  );

  return (
    <div className={`sonos-card ${embedded ? 'is-embedded' : ''}`}>
      {!embedded && (
        <div
          className='sonos-top'
          onClick={() => {
            if (topSlop.consumeBlockClick()) return;
            setCollapsed(v => !v);
          }}
          onTouchStart={topSlop.onTouchStart}
          onTouchMove={topSlop.onTouchMove}
          onTouchEnd={topSlop.onTouchEnd}
          onTouchCancel={topSlop.onTouchCancel}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setCollapsed(v => !v);
            }
          }}
          role='button'
          tabIndex={0}
          aria-expanded={!collapsed}
        >
          <span className='sonos-glyph'>
            <Icon icon='mdi:speaker' aria-hidden='true' />
          </span>
          <span className='sonos-title'>Sonos</span>
          {isOutOfSync && (
            <span
              className='sonos-sync-warning'
              title='Music Assistant and Sonos entities are out of sync. Controls may not work correctly.'
            >
              <Icon icon='mdi:alert-circle-outline' aria-hidden='true' />
            </span>
          )}
          {/* Collapsed quick actions (user 2026-08-07): play/pause + next without expanding.
              Same quick-dot grammar as the blind and light cards; play wears the Sonos
              green while something is playing. */}
          {collapsed && (
            <span className='sonos-quick' onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role='presentation'>
              <button
                type='button'
                className={`sonos-quick-btn ${isPlaying ? 'is-current' : ''}`}
                onClick={handlePlayPause}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                <Icon icon={isPlaying ? 'mdi:pause' : 'mdi:play'} aria-hidden='true' />
              </button>
              <button type='button' className='sonos-quick-btn' onClick={handleNext} aria-label='Next track' title='Next'>
                <Icon icon='mdi:skip-next' aria-hidden='true' />
              </button>
            </span>
          )}
          <span className='sonos-top-right'>
            <span className={`sonos-state ${isPlaying ? 'tint' : 'muted'}`}>{stateWord}</span>
            <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='sonos-chevron' />
          </span>
        </div>
      )}

      {(embedded || !collapsed) && face}

      {/* Speakers pop-up - swipe/tap on overlay closes, stopPropagation prevents RoomDetail closing */}
      {showGroupModal && (
        <div
          className='sonos-modal-overlay'
          onClick={requestCloseGroupModal}
          onTouchStart={handleModalTouchStart}
          onTouchMove={handleModalTouchMove}
          onTouchEnd={handleModalTouchEnd}
        >
          <div className='sonos-sheet' role='dialog' aria-modal='true' onClick={e => e.stopPropagation()}>
            <div className='sonos-sheet-top'>
              <span className='sonos-glyph'>
                <Icon icon='mdi:speaker-multiple' aria-hidden='true' />
              </span>
              <span className='sonos-title'>Speakers</span>
              <button className='sonos-sheet-close modal-close-button' onClick={requestCloseGroupModal} aria-label='Close'>
                <Icon icon='mdi:close' />
              </button>
            </div>

            <div className='sonos-sheet-body'>
              {groupVolumeEligibleCount >= 2 && (
                <div className='sonos-groupvol'>
                  <span className='sonos-groupvol-label'>Group volume</span>
                  <button
                    type='button'
                    className='sonos-mute sonos-groupvol-btn'
                    onClick={() => handleGroupVolumeStep(-1)}
                    aria-label='Group volume down'
                  >
                    <Icon icon='mdi:volume-minus' aria-hidden='true' />
                  </button>
                  <button
                    type='button'
                    className='sonos-mute sonos-groupvol-btn'
                    onClick={() => handleGroupVolumeStep(1)}
                    aria-label='Group volume up'
                  >
                    <Icon icon='mdi:volume-plus' aria-hidden='true' />
                  </button>
                </div>
              )}
              {/* Apple AirPlay-style picker: one list, one LINE per speaker, tap to toggle */}
              {pickerSpeakers.map(sp => {
                // Optimistic display: pending wins until the entity's group state converges.
                // shownIn also drives the layout, so joining grows the slider instantly.
                const pend = pendingGroup[sp.id];
                const inFlight = pend !== undefined && pend !== sp.isMember;
                const shownIn = inFlight ? pend : sp.isMember;

                // Members carry no subtitle (the join circle and crown say it) — the line below is theirs
                let subtitle = '';
                if (!sp.available) subtitle = 'Unavailable';
                else if (inFlight && !shownIn) subtitle = 'Leaving…';
                else if (!shownIn) {
                  if (sp.otherMasterName) subtitle = `With ${sp.otherMasterName}`;
                  else if (sp.playingTitle) subtitle = `Playing · ${sp.playingTitle}`;
                  else subtitle = 'Not playing';
                }

                const sliderValue = pickerVolumes[sp.id] ?? sp.volume;
                const memberPct = Math.max(0, Math.min(100, sliderValue));

                return (
                  <div key={sp.id} className={`sonos-sp ${shownIn ? 'is-member' : ''} ${!sp.available ? 'is-unavailable' : ''}`}>
                    <div className='sonos-sp-line'>
                      <button
                        type='button'
                        className='sonos-sp-name'
                        onClick={() => sp.available && handleToggleSpeaker(sp.id)}
                        disabled={!sp.available}
                        title={shownIn ? 'Tap to remove from group' : 'Tap to add to group'}
                      >
                        {sp.isMaster && <Icon icon='mdi:crown' className='sonos-sp-crown' aria-hidden='true' />}
                        <span>{sp.name}</span>
                        {sp.isThis && <span className='sonos-sp-this'>*</span>}
                      </button>
                      {subtitle && <span className='sonos-sp-sub'>{subtitle}</span>}
                      <button
                        type='button'
                        className={`sonos-join ${shownIn ? 'on' : ''} ${inFlight ? 'pending' : ''}`}
                        onClick={() => sp.available && handleToggleSpeaker(sp.id)}
                        disabled={!sp.available}
                        aria-label={shownIn ? `Remove ${sp.name}` : `Add ${sp.name}`}
                      >
                        {shownIn && <Icon icon={inFlight ? 'mdi:loading' : 'mdi:check'} aria-hidden='true' />}
                      </button>
                    </div>
                    {shownIn && sp.available && (
                      <div className='sonos-sp-line sonos-sp-line--vol'>
                        <button
                          type='button'
                          className={`sonos-mute ${sp.isMuted ? 'is-muted' : ''}`}
                          onClick={() => handleSpeakerMuteToggle(sp.actualId)}
                          aria-label={sp.isMuted ? `Unmute ${sp.name}` : `Mute ${sp.name}`}
                        >
                          <Icon icon={sp.isMuted ? 'mdi:volume-off' : 'mdi:volume-high'} aria-hidden='true' />
                        </button>
                        <div className='sonos-strip sonos-strip--mini'>
                          <div className='sonos-strip-fill' style={{ width: `${memberPct}%` }} />
                          <input
                            type='range'
                            className='sonos-strip-input'
                            min={0}
                            max={100}
                            step={1}
                            value={sliderValue}
                            onChange={e => setPickerVolumes(prev => ({ ...prev, [sp.id]: Number(e.target.value) }))}
                            onMouseUp={() => handleVolumeChange(sp.actualId, pickerVolumes[sp.id] ?? sp.volume)}
                            onTouchEnd={() => handleVolumeChange(sp.actualId, pickerVolumes[sp.id] ?? sp.volume)}
                            aria-label={`${sp.name} volume`}
                          />
                        </div>
                        <span className='sonos-volume-value'>{sliderValue}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Source sheet - one pop-up, three faces: the grid, the podcast feeds, a feed's episodes */}
      {(showSourcePicker || showPodcastModal) && (
        <div
          className='sonos-modal-overlay'
          onClick={handleOverlayCloseSourceSheet}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={handlePodcastTouchStart}
          onTouchMove={handlePodcastTouchMove}
          onTouchEnd={handlePodcastTouchEnd}
        >
          <div
            className='sonos-sheet'
            role='dialog'
            aria-modal='true'
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className='sonos-sheet-top'>
              {showPodcastModal && (
                <button
                  className='sonos-sheet-back'
                  onClick={viewingEpisodes ? handleBackToPodcasts : flipBackToSourceGrid}
                  aria-label='Back'
                >
                  <Icon icon='mdi:chevron-left' />
                </button>
              )}
              <span className={`sonos-glyph ${showPodcastModal ? 'is-podcast' : ''}`}>
                <Icon icon={showPodcastModal ? 'mdi:podcast' : 'mdi:speaker'} aria-hidden='true' />
              </span>
              <span className='sonos-title'>
                {viewingEpisodes
                  ? PODCAST_FEEDS.find(f => f.id === selectedPodcastId)?.title || 'Episodes'
                  : showPodcastModal
                    ? 'Podcasts'
                    : 'Source'}
              </span>
              <button className='sonos-sheet-close modal-close-button' onClick={handleCloseSourceSheet} aria-label='Close'>
                <Icon icon='mdi:close' />
              </button>
            </div>

            <div className='sonos-sheet-body'>
              {!showPodcastModal ? (
                <>
                  <div className='sonos-srcgrid'>
                    <div className='sonos-srctile'>
                      <button
                        type='button'
                        className='sonos-srcbtn sonos-srcbtn--bare'
                        onClick={handleSpotifyClick}
                        aria-label='Open Spotify'
                      >
                        <Icon icon='mdi:spotify' className='sonos-mark--spotify' aria-hidden='true' />
                      </button>
                      <span>Spotify{isSpotify ? ' · now' : ''}</span>
                    </div>

                    {RADIO_STATIONS.map(station => (
                      <div key={station.id} className='sonos-srctile'>
                        <button
                          type='button'
                          className='sonos-srcbtn sonos-srcbtn--logo'
                          onClick={() => handlePlayRadio(station.id)}
                          aria-label={station.name}
                        >
                          {station.logo ? (
                            <img src={station.logo} alt='' />
                          ) : (
                            <Icon icon={station.icon || 'mdi:radio'} aria-hidden='true' />
                          )}
                        </button>
                        <span>
                          {station.name}
                          {currentRadio?.id === station.id ? ' · now' : ''}
                        </span>
                      </div>
                    ))}

                    {PODCAST_FEEDS.length > 0 && (
                      <div className='sonos-srctile'>
                        <button
                          type='button'
                          className='sonos-srcbtn sonos-srcbtn--podcast'
                          onClick={handleOpenPodcastsPage}
                          aria-label='Podcasts'
                        >
                          <Icon icon='mdi:podcast' aria-hidden='true' />
                        </button>
                        <span>Podcasts{isPodcast ? ' · now' : ' ›'}</span>
                      </div>
                    )}

                    <div className='sonos-srctile'>
                      <button type='button' className='sonos-srcbtn' onClick={() => handleSelectSource('Audiocast')} aria-label='Audiocast'>
                        <Icon icon='mdi:cast' aria-hidden='true' />
                      </button>
                      <span>Audiocast{isLineIn(currentSource) ? ' · now' : ''}</span>
                    </div>

                    {tvSource && (
                      <div className='sonos-srctile'>
                        <button
                          type='button'
                          className='sonos-srcbtn sonos-srcbtn--tv'
                          onClick={() => handleSelectSource(tvSource)}
                          aria-label={getSourceDisplayName(tvSource)}
                        >
                          <Icon icon='mdi:television' aria-hidden='true' />
                        </button>
                        <span>
                          {getSourceDisplayName(tvSource)}
                          {tvSource === currentSource ? ' · now' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {otherInputSources.length > 0 && (
                    <div className='sonos-chips'>
                      {otherInputSources.map(source => (
                        <button
                          key={source}
                          type='button'
                          className={`sonos-chip ${source === currentSource ? 'on' : ''}`}
                          onClick={() => handleSelectSource(source)}
                        >
                          {getSourceDisplayName(source)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : !viewingEpisodes ? (
                // Podcast feed list
                <div className='sonos-rows'>
                  {[...PODCAST_FEEDS]
                    .sort((a, b) => a.title.localeCompare(b.title, 'da'))
                    .map(feed => (
                      <button key={feed.id} type='button' className='sonos-row' onClick={() => handleSelectPodcast(feed.id)}>
                        {feed.cover ? (
                          <img src={feed.cover} alt='' className='sonos-row-cover' />
                        ) : (
                          <span className='sonos-row-cover sonos-row-cover--empty'>
                            <Icon icon='mdi:podcast' aria-hidden='true' />
                          </span>
                        )}
                        <span className='sonos-row-title'>{feed.title}</span>
                        <Icon icon='mdi:chevron-right' className='sonos-row-chev' aria-hidden='true' />
                      </button>
                    ))}
                </div>
              ) : (
                // Episode list
                <>
                  {podcastError && <div className='sonos-note error'>{podcastError}</div>}
                  <div className='sonos-rows'>
                    {podcastLoading === selectedPodcastId ? (
                      <div className='sonos-note'>Loading episodes...</div>
                    ) : selectedPodcastId && podcastEpisodes[selectedPodcastId] && podcastEpisodes[selectedPodcastId].length > 0 ? (
                      podcastEpisodes[selectedPodcastId].map((ep: { title: string; url: string; pubDate?: string }) => (
                        <button
                          key={ep.url}
                          type='button'
                          className='sonos-row'
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
                            handleCloseSourceSheet();
                          }}
                        >
                          <span className='sonos-row-cover sonos-row-cover--empty'>
                            <Icon icon='mdi:play' aria-hidden='true' />
                          </span>
                          <span className='sonos-row-text'>
                            <span className='sonos-row-title'>{ep.title}</span>
                            {ep.pubDate && <span className='sonos-row-sub'>{ep.pubDate}</span>}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className='sonos-note'>No episodes found</div>
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
