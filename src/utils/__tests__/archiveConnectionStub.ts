import { vi } from 'vitest';

type Message = { type: string; service?: string; path?: string };

/** A stand-in for the HA websocket connection the archive helpers use: the two index shell_commands and auth/sign_path.
 * A signed path is the path plus `?authSig=<n>`, n counting every signature handed out. */
export function archiveConnection(indexes: Partial<Record<'doorbell_archive_index' | 'rober2_maps_index', unknown>>) {
  let signed = 0;
  const listeners = new Set<() => void>();
  const sendMessagePromise = vi.fn(async (message: Message) => {
    if (message.type === 'auth/sign_path') {
      signed += 1;
      return { path: `${message.path}?authSig=${signed}` };
    }
    if (message.type === 'call_service') {
      const index = indexes[message.service as keyof typeof indexes];
      if (index instanceof Error) return { response: { stdout: '', stderr: index.message, returncode: 1 } };
      return { response: { stdout: JSON.stringify(index ?? { absent: true }), stderr: '', returncode: 0 } };
    }
    throw new Error(`unexpected message ${message.type}`);
  });
  return {
    connection: {
      sendMessagePromise,
      addEventListener: (event: string, listener: () => void) => event === 'ready' && listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    },
    /** How many index reads went out for one service. */
    reads: (service: string) => sendMessagePromise.mock.calls.filter(([m]) => m.type === 'call_service' && m.service === service).length,
    /** The paths signed so far, in order. */
    signedPaths: () => sendMessagePromise.mock.calls.filter(([m]) => m.type === 'auth/sign_path').map(([m]) => m.path),
    /** What the connection does after HA comes back. */
    reconnect: () => listeners.forEach(listener => listener()),
  };
}
