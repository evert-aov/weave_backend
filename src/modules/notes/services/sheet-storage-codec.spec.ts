import { encodeSheetDocument, decodeSheetDocument, isSheetStorageEnvelope } from './sheet-storage-codec';
import { gzipSync } from 'node:zlib';

describe('Lossless spreadsheet storage', () => {
  const book = () => ({ title: 'Combustible – 日本語', activeSheetId: 'one', custom: { styles: ['preserve'], nested: null }, sheets: [{ id: 'one', name: 'Datos', type: 'grid', custom: { futureField: true }, data: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`A${i + 1}`, { raw: i % 3 ? '=PMT(8%/12,12,10000)' : '', styleId: 999, arbitrary: [0, false, ''], style: { bold: true, fontFamily: 'Times New Roman', bgColor: '#ffffff', borders: { bottom: { style: 'double', color: '#123456' } } } }])), merges: [{ startCol: 0, startRow: 0, endCol: 2, endRow: 1 }], charts: [{ chartTitle: 'Título', dataConfig: { seriesColumns: [1,5] }, custom: 'keep' }], workbookNames: { Ingreso: "'Datos'!A1:A3" }, tables: [{ name: 'Ventas', columns: ['A'] }], artwork: [{ arbitrary: 'SVG' }], inkStrokes: [{ points: [{ x: 3, y: 5 }] }] }] });
  it('preserves every field, empty cell, formula, style and unknown metadata without mutating input', async () => {
    const input = book(), before = JSON.stringify(input);
    const encoded = await encodeSheetDocument(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(isSheetStorageEnvelope(JSON.parse(encoded.toString()))).toBe(true);
    expect(encoded.length).toBeLessThan(Buffer.byteLength(before) / 5);
    expect(await decodeSheetDocument(encoded)).toEqual(input);
  });
  it('restores independently editable styles instead of aliasing multiple cells', async () => {
    const restored: any = await decodeSheetDocument(await encodeSheetDocument(book()));
    restored.sheets[0].data.A1.style.borders.bottom.color = '#000000';
    expect(restored.sheets[0].data.A2.style.borders.bottom.color).toBe('#123456');
  });
  it('reads existing indented JSON, nulls, empty styles and older workbook shapes', async () => {
    for (const value of [book(), { sheets: { legacy: { cellData: {} } }, arbitrary: [false, null] }, { sheets: [{ data: { A1: { raw: '', style: null }, A2: { raw: '', style: {} }, A3: { raw: '', style: false }, A4: { raw: '' } } }] }]) {
      expect(await decodeSheetDocument(JSON.stringify(value, null, 2))).toEqual(value);
      expect(await decodeSheetDocument(await encodeSheetDocument(value))).toEqual(value);
    }
  });
  it('rejects corrupted compressed data, invalid references and failed checksums', async () => {
    const envelope = JSON.parse((await encodeSheetDocument(book())).toString());
    await expect(decodeSheetDocument(JSON.stringify({ ...envelope, payload: 'AAAA' }))).rejects.toThrow();
    await expect(decodeSheetDocument(JSON.stringify({ ...envelope, sha256: '0'.repeat(64) }))).rejects.toThrow('checksum');
    const packed = Buffer.from(JSON.stringify({ data: { sheets: [{ data: { A1: { raw: '' } } }] }, styles: [{}], references: [{ sheet: 0, cells: [['A1', 55]] }] }));
    await expect(decodeSheetDocument(JSON.stringify({ ...envelope, payload: gzipSync(packed).toString('base64'), packedBytes: packed.length }))).rejects.toThrow('style index');
    await expect(decodeSheetDocument(JSON.stringify({ ...envelope, version: 9 }))).rejects.toThrow('version');
  });
  it('preserves JSON properties named __proto__ without prototype pollution', async () => {
    const value = JSON.parse('{"sheets":[{"data":{"A1":{"raw":"x","style":{"__proto__":{"polluted":true}}}}}],"__proto__":{"keep":true}}');
    expect(await decodeSheetDocument(await encodeSheetDocument(value))).toEqual(value);
    expect(({} as any).polluted).toBeUndefined();
  });
});
