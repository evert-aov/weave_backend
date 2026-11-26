import { DocumentStorageService } from './document-storage.service';
import { decodeSheetDocument, encodeSheetDocument } from './sheet-storage-codec';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const workbook = (value = 'one') => ({ sheets: [{ id: 's', name: 'Datos', data: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`A${i+1}`, { raw: value, style: { fontFamily: 'Times New Roman', fontSize: 12, bold: true, borders: { bottom: { style: 'double', color: '#112233' } } } }])) }], activeSheetId: 's', custom: [null, false, '日本語'] });
describe('DocumentStorageService lossless storage', () => {
  let directory: string, service: DocumentStorageService;
  const variables = ['R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'];
  const environment = Object.fromEntries(variables.map(key => [key, process.env[key]]));
  beforeEach(async () => {
    for (const key of variables) delete process.env[key];
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weave-storage-test-'));
    service = new DocumentStorageService(); (service as any).documentsDir = directory;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    jest.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true });
    for (const key of variables) { if (environment[key] === undefined) delete process.env[key]; else process.env[key] = environment[key]; }
  });
  const file = (directory: string) => path.join(directory, 'note_sheet.json');
  function r2(client: { send: jest.Mock }) { (service as any).s3Client = client; (service as any).bucketName = 'test-bucket'; }

  it('saves compact storage at the existing URL and reads back the full native model', async () => {
    const input = workbook();
    expect(await service.saveDocument('note', 'sheet', input)).toBe('/uploads/documents/note_sheet.json');
    const stored = await fs.readFile(file(directory));
    expect(stored.length).toBeLessThan(Buffer.byteLength(JSON.stringify(input)) / 5);
    expect(JSON.parse(stored.toString()).format).toBe('weave-sheet-storage');
    expect(await service.readDocument('note', 'sheet')).toEqual(input);
  });
  it('still reads legacy documents without modifying their bytes', async () => {
    const input = workbook(), original = JSON.stringify(input, null, 2);
    await fs.writeFile(file(directory), original);
    expect(await service.readDocument('note', 'sheet')).toEqual(input);
    expect(await fs.readFile(file(directory), 'utf8')).toBe(original);
  });
  it('keeps the previous document when publishing a save fails and cleans up the temporary file', async () => {
    const previous = JSON.stringify(workbook('previous'));
    await fs.writeFile(file(directory), previous);
    jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
    await expect(service.saveDocument('note', 'sheet', workbook('new'))).rejects.toThrow('rename failed');
    expect(await fs.readFile(file(directory), 'utf8')).toBe(previous);
    expect(await fs.readdir(directory)).toEqual(['note_sheet.json']);
  });
  it('does not turn a corrupt workbook into a missing document', async () => {
    await fs.writeFile(file(directory), '{ broken JSON');
    await expect(service.readDocument('note', 'sheet')).rejects.toThrow('No se pudo leer');
    expect(await fs.readFile(file(directory), 'utf8')).toBe('{ broken JSON');
    expect(await service.readDocument('absent', 'sheet')).toBeNull();
  });
  it('serializes concurrent saves and snapshots data before awaiting I/O', async () => {
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), firstStarted = new Promise<void>(resolve => started = resolve);
    const bodies: unknown[] = [];
    const send = jest.fn().mockImplementation(async command => {
      bodies.push(await decodeSheetDocument(command.input.Body));
      if (bodies.length === 1) { started(); await gate; }
      return {};
    }); r2({ send });
    const first = workbook('first'), pendingFirst = service.saveDocument('note','sheet',first);
    first.sheets[0].data.A1.raw = 'mutated after call';
    const pendingSecond = service.saveDocument('note','sheet',workbook('second'));
    await firstStarted; expect(send).toHaveBeenCalledTimes(1); release();
    await Promise.all([pendingFirst,pendingSecond]);
    expect(bodies).toEqual([workbook('first'),workbook('second')]);
    expect(await service.readDocument('note','sheet')).toEqual(workbook('second'));
  });
  it('decodes and caches verified R2 storage without changing its native API response', async () => {
    const input = workbook(), encoded = await encodeSheetDocument(input);
    r2({ send: jest.fn().mockResolvedValue({ Body: { transformToString: async () => encoded.toString() } }) });
    expect(await service.readDocument('note','sheet')).toEqual(input);
    expect(await fs.readFile(file(directory))).toEqual(encoded);
  });
  it('rejects a corrupt R2 response without writing it to the cache', async () => {
    r2({ send: jest.fn().mockResolvedValue({ Body: { transformToString: async () => '{"format":"weave-sheet-storage","version":99}' } }) });
    await expect(service.readDocument('note','sheet')).rejects.toThrow('No se pudo leer');
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('leaves the other specialized JSON document formats unchanged', async () => {
    const document = { title: 'Doc', body: { html: '<p>Example</p>' } };
    await service.saveDocument('note','doc',document);
    expect(await fs.readFile(path.join(directory, 'note_doc.json'),'utf8')).toBe(JSON.stringify(document,null,2));
    expect(await service.readDocument('note','doc')).toEqual(document);
  });
});
