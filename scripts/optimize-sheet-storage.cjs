#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gzip, gunzip } = require('node:zlib');
const { promisify, isDeepStrictEqual } = require('node:util');
const compress = promisify(gzip), decompress = promisify(gunzip);
const { encodeSheetDocument, decodeSheetDocument, isSheetStorageEnvelope } = require('../dist/modules/notes/services/sheet-storage-codec.js');
const { writeDocumentAtomically } = require('../dist/modules/notes/services/atomic-document-file.js');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function optimizeSheets(options = {}) {
  if (options.write && (!options.readersReady || !options.offline)) throw new Error('Before writing, stop every backend writer and install the new reader, then pass --offline --readers-ready.');
  const directory = path.resolve(options.directory || path.join(process.cwd(), 'uploads/documents'));
  const backupDirectory = path.resolve(options.backupDirectory || path.join(process.cwd(), 'backups/sheet-storage'));
  const names = options.files?.length ? options.files : await fs.readdir(directory);
  const results = [];
  for (const name of names) {
    if (path.basename(name) !== name || !/_sheet\.json$/.test(name)) { if (options.files?.length) throw new Error('Only spreadsheet filenames in the selected directory are accepted.'); continue; }
    const filename = path.join(directory, name), stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const original = await fs.readFile(filename), native = await decodeSheetDocument(original);
    if (isSheetStorageEnvelope(JSON.parse(original.toString('utf8')))) { results.push({ file: name, before: original.length, after: original.length, status: 'already-optimized' }); continue; }
    const encoded = await encodeSheetDocument(native), roundTrip = await decodeSheetDocument(encoded);
    if (!isDeepStrictEqual(native, roundTrip)) throw new Error(`Verification failed for ${name}; original was not changed.`);
    const result = { file: name, before: original.length, after: encoded.length, status: encoded.length < original.length ? options.write ? 'optimized' : 'verified-dry-run' : 'unchanged' };
    if (options.write && encoded.length < original.length) {
      await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const backup = path.join(backupDirectory, `${name}.${sha256(original)}.gz`);
      try { await fs.writeFile(backup, await compress(original, { level: 9 }), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!original.equals(await decompress(await fs.readFile(backup)))) throw new Error(`Backup verification failed for ${name}; original was not changed.`);
      // Refuse a stale migration snapshot if a user or backend saved while verification ran.
      if (!original.equals(await fs.readFile(filename))) throw new Error(`${name} changed during migration; it was not replaced. Stop writers and retry.`);
      await writeDocumentAtomically(filename, encoded);
      if (!isDeepStrictEqual(native, await decodeSheetDocument(await fs.readFile(filename)))) {
        await writeDocumentAtomically(filename, original);
        throw new Error(`Post-write verification failed for ${name}; original restored.`);
      }
      result.backup = backup;
    }
    results.push(result);
  }
  return results;
}
module.exports = { optimizeSheets };
if (require.main === module) {
  const args = process.argv.slice(2), options = { files: [], write: false, readersReady: false, offline: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--readers-ready') options.readersReady = true;
    else if (arg === '--offline') options.offline = true;
    else if (arg === '--dry-run') options.write = false;
    else if (arg === '--directory') options.directory = args[++index];
    else if (arg === '--backup-dir') options.backupDirectory = args[++index];
    else if (arg === '--file') options.files.push(args[++index]);
    else { process.stderr.write(`Unknown option: ${arg}\n`); process.exitCode = 1; return; }
  }
  optimizeSheets(options).then(results => process.stdout.write(JSON.stringify({ mode: options.write ? 'write' : 'dry-run', results }, null, 2) + '\n')).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
