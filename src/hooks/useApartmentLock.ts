import { useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { HassEntities } from '../types';
import { apartmentLockToggleCommand, resolveApartmentLock } from '../utils/apartmentLock';

type LockModel = ReturnType<typeof resolveApartmentLock>;
type LockCommand = NonNullable<LockModel['command']>;
type Sent = { command: LockCommand; atMs: number };

// A jam counts as ours when the lock reports it within this span around our own command.
// The early slack absorbs clock skew between the phone and HA.
const JAM_EARLY_SLACK_MS = 30_000;
const JAM_AFTER_COMMAND_MS = 120_000;

/** The bolt can stall short of its end position right after our own command (Yale
 * MECH_POSITION). Repeating that same command usually completes it, so offer exactly
 * that; a jam nobody here caused stays without a command. */
function jamRetry(model: LockModel, sent: Sent | null): LockCommand | null {
  if (model.state !== 'jammed' || !sent || !model.since) return null;
  const jamMs = Date.parse(model.since);
  return jamMs >= sent.atMs - JAM_EARLY_SLACK_MS && jamMs <= sent.atMs + JAM_AFTER_COMMAND_MS ? sent.command : null;
}

/** Apartment-only command handling. HA acknowledges the service request; the
 * semantic entity remains the only confirmation of the physical lock state. */
export function useApartmentLock(entities: HassEntities, enabled: boolean) {
  const model = resolveApartmentLock(entities);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const retry = model.command ? null : jamRetry(model, sent);
  const shown = model.command ?? retry;
  const actionLabel = retry ? `Jammed. Try ${retry.service === 'unlock' ? 'unlocking' : 'locking'} again` : model.actionLabel;

  const send = async () => {
    if (!enabled || inFlight.current) return null;
    const { entities: latest, connection } = useHass.getState();
    const latestRetry = jamRetry(resolveApartmentLock(latest), sent);
    const command = apartmentLockToggleCommand(latest, shown?.service) ?? (latestRetry?.service === shown?.service ? latestRetry : null);
    if (!command) return null;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const atMs = Date.now();
    try {
      if (!connection?.connected) throw new Error('Not connected');
      // HAKit's fire-and-forget helper hides service failures. Request the WS
      // acknowledgement directly, WITHOUT return_response (lock has no response data).
      await connection.sendMessagePromise({ type: 'call_service', ...command });
      if (mounted.current) setSent({ command, atMs });
      return command === latestRetry ? `retry ${command.service}` : command.service;
    } catch {
      // No automatic retry through the other twin: a failed acknowledgement does
      // not prove the first command failed to reach the physical lock.
      if (mounted.current) setError(`Could not ${command.service} the apartment. Check the lock before trying again.`);
      return null;
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return { ...model, command: shown, actionLabel, pending, error, send, disabled: !enabled || !shown || pending };
}
