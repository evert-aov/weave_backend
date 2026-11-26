import { createHash } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify, isDeepStrictEqual } from 'node:util';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const FORMAT = 'weave-sheet-storage';
const MAX_BYTES = 128 * 1024 * 1024;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface PackedSheet {
  data: Json;
  styles: Json[];
  references: { sheet: number; cells: [string, number][] }[];
}
interface Envelope {
  format: typeof FORMAT;
  version: 1;
  encoding: 'gzip-base64';
  sha256: string;
  packedBytes: number;
  payload: string;
}
function parseJson(text: string): unknown { try { return JSON.parse(text); } catch { throw new Error('Invalid spreadsheet JSON.'); } }
const object = (value: unknown): value is Record<string, Json> => value !== null && typeof value === 'object' && !Array.isArray(value);
function canonical(value: Json): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = (value: Json) => createHash('sha256').update(canonical(value)).digest('hex');
export function isSheetStorageEnvelope(value: unknown): boolean { return object(value) && value['format'] === FORMAT; }
function pack(data: Json): PackedSheet {
  // This is a private JSON-normalized clone: callers and their styles remain untouched.
  const cloned = JSON.parse(JSON.stringify(data)) as Json;
  const styles: Json[] = [], references: PackedSheet['references'] = [], index = new Map<string, number>();
  const sheets = object(cloned) && Array.isArray(cloned['sheets']) ? cloned['sheets'] : [];
  sheets.forEach((sheet, sheetIndex) => {
    if (!object(sheet) || !object(sheet['data'])) return;
    const cells: [string, number][] = [];
    for (const [id, cell] of Object.entries(sheet['data'])) {
      if (!object(cell) || !Object.hasOwn(cell, 'style')) continue;
      const style = cell['style'], key = canonical(style);
      let styleIndex = index.get(key);
      if (styleIndex === undefined) { styleIndex = styles.length; index.set(key, styleIndex); styles.push(style); }
      cells.push([id, styleIndex]); delete cell['style'];
    }
    if (cells.length) references.push({ sheet: sheetIndex, cells });
  });
  return { data: cloned, styles, references };
}
function unpack(value: unknown): Json {
  if (!object(value) || !Object.hasOwn(value, 'data') || !Array.isArray(value['styles']) || !Array.isArray(value['references'])) throw new Error('Invalid spreadsheet storage payload.');
  const packed = value as unknown as PackedSheet;
  const styles = packed.styles.map(style => JSON.stringify(style));
  let expandedBytes = Buffer.byteLength(JSON.stringify(packed.data));
  const sheets = object(packed.data) && Array.isArray(packed.data['sheets']) ? packed.data['sheets'] : [];
  // Validate every reference before allocating independently editable style objects.
  const seen = new Set<string>();
  for (const group of packed.references) {
    if (!group || !Number.isInteger(group.sheet) || group.sheet < 0 || !Array.isArray(group.cells)) throw new Error('Invalid spreadsheet style references.');
    const sheet = sheets[group.sheet];
    if (!object(sheet) || !object(sheet['data'])) throw new Error('Spreadsheet style reference has no worksheet.');
    for (const entry of group.cells) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Number.isInteger(entry[1]) || entry[1] < 0 || entry[1] >= styles.length) throw new Error('Invalid spreadsheet style index.');
      const [id, style] = entry, key = JSON.stringify([group.sheet, id]);
      if (!Object.hasOwn(sheet['data'], id) || !object(sheet['data'][id]) || Object.hasOwn(sheet['data'][id], 'style') || seen.has(key)) throw new Error('Invalid or duplicate spreadsheet style target.');
      seen.add(key); expandedBytes += Buffer.byteLength(styles[style]) + 9;
      if (expandedBytes > MAX_BYTES) throw new Error('Spreadsheet storage exceeds the expanded size limit.');
    }
  }
  for (const group of packed.references) {
    const grid = (sheets[group.sheet] as Record<string, Json>)['data'] as Record<string, Record<string, Json>>;
    for (const [id, style] of group.cells) Object.defineProperty(grid[id], 'style', { value: JSON.parse(styles[style]), enumerable: true, writable: true, configurable: true });
  }
  return packed.data;
}
/** Compact lossless storage; the HTTP document model remains the ordinary workbook JSON. */
export async function encodeSheetDocument(input: unknown): Promise<Buffer> {
  const plain = JSON.stringify(input ?? {}), normalized = JSON.parse(plain) as Json;
  if (Buffer.byteLength(plain) > MAX_BYTES) throw new Error('Spreadsheet exceeds the storage size limit.');
  const packed = pack(normalized);
  // Never publish a new storage representation unless its semantic round trip is exact.
  const roundTrip = unpack(JSON.parse(JSON.stringify(packed)));
  if (!isDeepStrictEqual(normalized, roundTrip)) throw new Error('Spreadsheet storage verification failed.');
  const bytes = Buffer.from(JSON.stringify(packed));
  if (bytes.length > MAX_BYTES) return Buffer.from(plain);
  const compressed = await compress(bytes, { level: 9 });
  const envelope: Envelope = { format: FORMAT, version: 1, encoding: 'gzip-base64', sha256: digest(normalized), packedBytes: bytes.length, payload: compressed.toString('base64') };
  const encoded = Buffer.from(JSON.stringify(envelope));
  return encoded.length < Buffer.byteLength(plain) ? encoded : Buffer.from(plain);
}
/** Supports legacy JSON and verifies both compressed contents and restored native data. */
export async function decodeSheetDocument(input: string | Uint8Array): Promise<unknown> {
  const parsed = parseJson(typeof input === 'string' ? input : Buffer.from(input).toString('utf8'));
  if (!isSheetStorageEnvelope(parsed)) return parsed;
  const envelope = parsed as Envelope;
  if (envelope.version !== 1 || envelope.encoding !== 'gzip-base64') throw new Error('Unsupported spreadsheet storage version.');
  if (!Number.isInteger(envelope.packedBytes) || envelope.packedBytes <= 0 || envelope.packedBytes > MAX_BYTES || !/^[a-f0-9]{64}$/.test(envelope.sha256) || typeof envelope.payload !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.payload)) throw new Error('Invalid spreadsheet storage envelope.');
  const bytes = await decompress(Buffer.from(envelope.payload, 'base64'), { maxOutputLength: Math.min(MAX_BYTES, envelope.packedBytes) });
  if (bytes.length !== envelope.packedBytes) throw new Error('Spreadsheet storage length mismatch.');
  const restored = unpack(parseJson(bytes.toString('utf8')));
  if (digest(restored) !== envelope.sha256) throw new Error('Spreadsheet storage checksum mismatch.');
  return restored;
}
