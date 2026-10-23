import { useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { HassEntities } from '../types';
import { apartmentLockToggleCommand, resolveApartmentLock } from '../utils/apartmentLock';

/** Apartment-only command handling. HA acknowledges the service request; the
 * semantic entity remains the only confirmation of the physical lock state. */
export function useApartmentLock(entities: HassEntities, enabled: boolean) {
  const model = resolveApartmentLock(entities);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = async () => {
    if (!enabled || inFlight.current) return null;
    const { entities: latest, connection } = useHass.getState();
    const command = apartmentLockToggleCommand(latest, model.command?.service);
    if (!command) return null;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      if (!connection?.connected) throw new Error('Not connected');
      // HAKit's fire-and-forget helper hides service failures. Request the WS
      // acknowledgement directly, WITHOUT return_response (lock has no response data).
      await connection.sendMessagePromise({ type: 'call_service', ...command });
      return command.service;
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

  return { ...model, pending, error, send, disabled: !enabled || !model.command || pending };
}
