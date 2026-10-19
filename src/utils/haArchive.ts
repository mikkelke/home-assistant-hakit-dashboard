import { useHass } from '@hakit/core';

/** The doorbell and Rober2 map archives and the coffee curves live in HA's media folder, which HA serves at /media/local/
 * to signed-in users only. Each index comes through one of these shell_commands (HA's configuration.yaml), and every
 * file the dashboard shows is signed first. */
export type ArchiveIndexService = 'doorbell_archive_index' | 'rober2_maps_index' | 'coffee_recent';

/** Seconds a signed URL lives. Short, because Traefik's access log keeps query strings; a view that outlasts it signs
 * once more on the media error (useSignedArchiveUrl). */
const SIGN_TTL_S = 300;
/** Signatures in flight at once. */
const MAX_SIGNING = 4;

function connection() {
  const conn = useHass.getState().connection;
  if (!conn) throw new Error('Not connected to Home Assistant');
  return conn;
}

type ShellReply = { response?: { stdout?: unknown; stderr?: unknown; returncode?: unknown } };

async function loadIndex(service: ArchiveIndexService): Promise<object | null> {
  const reply = await connection().sendMessagePromise<ShellReply>({
    type: 'call_service',
    domain: 'shell_command',
    service,
    service_data: {},
    return_response: true,
  });
  const { stdout, stderr, returncode } = reply?.response ?? {};
  if (returncode !== 0 || stderr) throw new Error(`${service}: returncode ${String(returncode)} ${String(stderr ?? '')}`);
  const data: unknown = JSON.parse(String(stdout));
  if (typeof data !== 'object' || data === null) throw new Error(`${service}: not an index`);
  return (data as { absent?: unknown }).absent === true ? null : data;
}

const pendingIndex = new Map<ArchiveIndexService, Promise<object | null>>();

/** An archive's index.json, or null while the archive does not exist yet. Any other failure rejects. Reads that
 * overlap share one call. */
export function readArchiveIndex(service: ArchiveIndexService): Promise<object | null> {
  let pending = pendingIndex.get(service);
  if (!pending) {
    pending = loadIndex(service).finally(() => pendingIndex.delete(service));
    pendingIndex.set(service, pending);
  }
  return pending;
}

let signing = 0;
const waiting: (() => void)[] = [];

/** A signed URL for one archive file, with at most MAX_SIGNING requests in flight. A view that closed while its request
 * waited (`gone`) gets '' and costs nothing. */
export async function signArchivePath(path: string, gone: () => boolean): Promise<string> {
  if (signing < MAX_SIGNING) signing += 1;
  else await new Promise<void>(resolve => waiting.push(resolve)); // the finishing request hands its slot over
  try {
    if (gone()) return '';
    return (await connection().sendMessagePromise<{ path: string }>({ type: 'auth/sign_path', path, expires: SIGN_TTL_S })).path;
  } finally {
    const next = waiting.shift();
    if (next) next();
    else signing -= 1;
  }
}
