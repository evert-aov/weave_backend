import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Publish a complete file with an atomic rename, leaving the previous document intact on failure. */
export async function writeDocumentAtomically(filename: string, content: string | Uint8Array): Promise<void> {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content); await handle.sync(); await handle.close(); handle = undefined;
    await fs.rename(temporary, filename);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}
