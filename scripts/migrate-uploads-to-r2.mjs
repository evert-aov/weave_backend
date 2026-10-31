import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || 'obsidian-vault';
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

const MIME_TYPES = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function getFilesRecursively(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file.startsWith('.~lock.')) continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push({ fullPath, relPath, size: stat.size });
    }
  }
  return results;
}

async function fileExistsInR2(key, localSize) {
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return head.ContentLength === localSize;
  } catch {
    return false;
  }
}

async function uploadFile(fileObj, index, total) {
  const key = `uploads/${fileObj.relPath}`;
  const ext = path.extname(fileObj.fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const exists = await fileExistsInR2(key, fileObj.size);
  if (exists) {
    console.log(`[${index + 1}/${total}] Exists on R2 (skipped): ${key}`);
    return { status: 'skipped', key };
  }

  const stream = fs.createReadStream(fileObj.fullPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: stream,
      ContentLength: fileObj.size,
      ContentType: contentType,
    })
  );

  console.log(`[${index + 1}/${total}] Uploaded: ${key} (${(fileObj.size / 1024).toFixed(1)} KB)`);
  return { status: 'uploaded', key };
}

async function runMigration() {
  console.log(`Starting migration of files to Cloudflare R2 bucket: ${BUCKET}`);
  console.log(`Source directory: ${UPLOADS_DIR}`);

  const files = getFilesRecursively(UPLOADS_DIR);
  console.log(`Found ${files.length} files to migrate.`);

  // Upload with concurrency of 5
  const CONCURRENCY = 5;
  let activeIndex = 0;
  let uploadedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  async function worker() {
    while (activeIndex < files.length) {
      const i = activeIndex++;
      const file = files[i];
      try {
        const res = await uploadFile(file, i, files.length);
        if (res.status === 'uploaded') uploadedCount++;
        else skippedCount++;
      } catch (err) {
        console.error(`Error uploading ${file.relPath}:`, err.message);
        errorCount++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log('\n--- Migration Finished ---');
  console.log(`Total files: ${files.length}`);
  console.log(`Uploaded: ${uploadedCount}`);
  console.log(`Skipped (already in R2): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
}

runMigration().catch((err) => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
