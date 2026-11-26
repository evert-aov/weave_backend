const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { optimizeSheets } = require('./optimize-sheet-storage.cjs');
const { decodeSheetDocument } = require('../dist/modules/notes/services/sheet-storage-codec.js');

test('verified migration, byte-exact backup, old-reader protection and idempotence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weave-migration-'));
  const backupDirectory = path.join(directory, 'backups');
  const data = { sheets: [{ name: 'Datos', data: Object.fromEntries(Array.from({length:200}, (_,i)=>[`A${i+1}`,{raw:'=PMT(0.01,12,1200)',style:{bold:true,fontFamily:'Times New Roman',borders:{bottom:{color:'#123456',style:'double'}}}}])) }], custom: { unknown: 'keep', empty: '' } };
  const filename = path.join(directory, 'sample_sheet.json'), original = JSON.stringify(data,null,2);
  try {
    await fs.writeFile(filename, original);
    const options = { directory, backupDirectory };
    const dry = await optimizeSheets(options);
    assert.equal(dry[0].status, 'verified-dry-run'); assert.equal(await fs.readFile(filename,'utf8'),original);
    await assert.rejects(optimizeSheets({...options,write:true}),/backend writer/);
    assert.equal(await fs.readFile(filename,'utf8'),original);
    const [result] = await optimizeSheets({...options,write:true,readersReady:true,offline:true});
    assert.equal(result.status,'optimized');
    assert.deepEqual(await decodeSheetDocument(await fs.readFile(filename)),data);
    assert.equal(gunzipSync(await fs.readFile(result.backup)).toString(),original);
    assert.equal((await optimizeSheets({...options,write:true,readersReady:true,offline:true}))[0].status,'already-optimized');
    assert.equal((await fs.readdir(backupDirectory)).length,1);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
