import { useCallback, useEffect, useState } from 'react';
import type { ApplianceFeedbackJson, ApplianceHistorySheetProps } from './ApplianceHistorySheet';

/** A feedback URL from its build-time env value: trimmed, or null when unset or blank. */
export function feedbackUrlFrom(value: unknown): string | null {
  const url = typeof value === 'string' ? value.trim() : '';
  return url || null;
}

/** What the history sheet needs of the stored cycles. */
export type ApplianceHistoryState = Pick<
  ApplianceHistorySheetProps,
  | 'cyclesNewestFirst'
  | 'hasFeedbackData'
  | 'feedbackLoading'
  | 'feedbackError'
  | 'fetchFeedback'
  | 'cycleSelection'
  | 'setCycleSelection'
  | 'savingCycleIndex'
  | 'handleConfirmCycle'
>;

/** Loads the cycle history from `url` (when there is one) and saves a confirmed or corrected
 * programme back to it. Spread the result into `ApplianceHistorySheet`. */
export function useApplianceFeedback(url: string | null): ApplianceHistoryState {
  const [feedbackData, setFeedbackData] = useState<ApplianceFeedbackJson | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [savingCycleIndex, setSavingCycleIndex] = useState<number | null>(null);
  /** Per-row programme selection for confirm/correct (newest-first index -> programme key) */
  const [cycleSelection, setCycleSelection] = useState<Record<number, string>>({});

  const fetchFeedback = useCallback(async () => {
    if (!url) return;
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApplianceFeedbackJson = await res.json();
      if (!data || !Array.isArray(data.cycles)) {
        setFeedbackData({ version: data?.version ?? 2, cycles: [] });
      } else {
        setFeedbackData(data);
      }
    } catch (e) {
      setFeedbackError(e instanceof Error ? e.message : 'Failed to load');
      setFeedbackData(null);
    } finally {
      setFeedbackLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (url) fetchFeedback();
  }, [url, fetchFeedback]);

  const persistFeedback = useCallback(
    async (payload: ApplianceFeedbackJson) => {
      if (!url) return;
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setFeedbackData(payload);
        setFeedbackError(null);
      } catch (e) {
        setFeedbackError(e instanceof Error ? e.message : 'Failed to save');
      }
    },
    [url]
  );

  const handleConfirmCycle = useCallback(
    async (cycleIndex: number) => {
      if (!feedbackData || url == null) return;
      const cycles = [...feedbackData.cycles];
      const idx = cycles.length - 1 - cycleIndex;
      if (idx < 0 || idx >= cycles.length) return;
      const programmeKey = cycleSelection[cycleIndex] ?? cycles[idx].predicted;
      setSavingCycleIndex(cycleIndex);
      cycles[idx] = {
        ...cycles[idx],
        confirmed: programmeKey,
        programme_confirmed_by_human: true,
      };
      await persistFeedback({ ...feedbackData, cycles });
      setSavingCycleIndex(null);
      setCycleSelection(prev => {
        const next = { ...prev };
        delete next[cycleIndex];
        return next;
      });
    },
    [feedbackData, url, persistFeedback, cycleSelection]
  );

  return {
    cyclesNewestFirst: feedbackData?.cycles ? [...feedbackData.cycles].reverse() : [],
    hasFeedbackData: feedbackData !== null,
    feedbackLoading,
    feedbackError,
    fetchFeedback,
    cycleSelection,
    setCycleSelection,
    savingCycleIndex,
    handleConfirmCycle,
  };
}
