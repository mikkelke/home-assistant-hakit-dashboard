import { describe, expect, it, vi } from 'vitest';
import { archiveConnection } from './archiveConnectionStub';

const store = vi.hoisted(() => ({ state: { connection: undefined as unknown } }));
vi.mock('@hakit/core', () => ({ useHass: { getState: () => store.state } }));

const { readArchiveIndex, signArchivePath } = await import('../haArchive');

/** A connection whose index command printed `response`. */
const printing = (response: unknown) => ({ sendMessagePromise: vi.fn(async () => ({ response })) });

describe('readArchiveIndex', () => {
  it('returns the index its shell_command printed', async () => {
    store.state.connection = archiveConnection({ rober2_maps_index: { maps: [{ filename: 'a.png' }] } }).connection;
    await expect(readArchiveIndex('rober2_maps_index')).resolves.toEqual({ maps: [{ filename: 'a.png' }] });
  });

  it('reads an archive that does not exist yet as null', async () => {
    store.state.connection = archiveConnection({}).connection;
    await expect(readArchiveIndex('doorbell_archive_index')).resolves.toBeNull();
  });

  it('rejects a failed command, any stderr, and output that is not an index', async () => {
    for (const response of [
      { stdout: '', stderr: 'cat: /media/abb_doorbell/index.json: Permission denied', returncode: 1 },
      { stdout: '{"images": []}', stderr: 'warning', returncode: 0 },
      { stdout: '{"images": [', stderr: '', returncode: 0 },
      { stdout: 'null', stderr: '', returncode: 0 },
      { stdout: '', stderr: '', returncode: 0 },
      undefined,
    ]) {
      store.state.connection = printing(response);
      await expect(readArchiveIndex('doorbell_archive_index')).rejects.toThrow();
    }
  });

  it('rejects without a connection', async () => {
    store.state.connection = undefined;
    await expect(readArchiveIndex('doorbell_archive_index')).rejects.toThrow('Not connected');
  });

  it('shares one read between callers that overlap, and reads afresh after', async () => {
    const ha = archiveConnection({ doorbell_archive_index: { images: [] } });
    store.state.connection = ha.connection;
    const [a, b] = await Promise.all([readArchiveIndex('doorbell_archive_index'), readArchiveIndex('doorbell_archive_index')]);
    expect(a).toBe(b);
    expect(ha.reads('doorbell_archive_index')).toBe(1);
    await readArchiveIndex('doorbell_archive_index');
    expect(ha.reads('doorbell_archive_index')).toBe(2);
  });
});

describe('signArchivePath', () => {
  it('asks HA for a five-minute signature of the path', async () => {
    const ha = archiveConnection({});
    store.state.connection = ha.connection;
    await expect(signArchivePath('/media/local/rober2_maps/a.png', () => false)).resolves.toBe('/media/local/rober2_maps/a.png?authSig=1');
    expect(ha.connection.sendMessagePromise).toHaveBeenCalledWith({
      type: 'auth/sign_path',
      path: '/media/local/rober2_maps/a.png',
      expires: 300,
    });
  });

  it('keeps four signatures in flight at most, and skips a view that went away while it waited', async () => {
    const waiting: (() => void)[] = [];
    let inFlight = 0;
    let most = 0;
    const sendMessagePromise = vi.fn(
      (message: { path: string }) =>
        new Promise<{ path: string }>(resolve => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          waiting.push(() => {
            inFlight -= 1;
            resolve({ path: `${message.path}?authSig=x` });
          });
        })
    );
    store.state.connection = { sendMessagePromise };
    const gone = new Set([5, 6]);
    const signed = Promise.all(Array.from({ length: 10 }, (_, i) => signArchivePath(`/media/local/x/${i}.jpg`, () => gone.has(i))));
    while (waiting.length > 0 || sendMessagePromise.mock.calls.length < 8) {
      await Promise.resolve();
      waiting.shift()?.();
    }
    const urls = await signed;
    expect(most).toBe(4);
    expect(sendMessagePromise).toHaveBeenCalledTimes(8);
    expect(urls[5]).toBe('');
    expect(urls[9]).toBe('/media/local/x/9.jpg?authSig=x');
  });
});
