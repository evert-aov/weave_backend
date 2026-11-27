import { encodeSheetDocument, decodeSheetDocument } from './sheet-storage-codec';
import { writeDocumentAtomically } from './atomic-document-file';
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

/**
 * Contrato de almacenamiento para documentos especializados (hojas de cálculo,
 * documentos de texto enriquecido, lienzos vectoriales y presentaciones).
 */
export interface IDocumentStorageService {
  saveDocument(noteId: string, docType: string, data: any): Promise<string>;
  readDocument(noteId: string, docType: string): Promise<any>;
  savePptx(noteId: string, base64: string): Promise<string>;
  readPptxBase64(noteId: string): Promise<string | null>;
  deleteDocument(noteId: string, docType?: string): Promise<void>;
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_DOC_TYPES = new Set(['doc', 'sheet', 'canvas', 'slide']);
const INLINE_DATA_IMAGE_RE = /data:(image\/(?:png|jpeg|jpg|webp|gif|bmp|svg\+xml));base64,([A-Za-z0-9+/=]+)/gi;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
};

function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  const cleaned = buffer
    .toString('utf8')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:iframe|object|embed|foreignObject)\b[\s\S]*?<\/(?:iframe|object|embed|foreignObject)>/gi, '')
    .replace(/<(?:iframe|object|embed|foreignObject)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');
  return Buffer.from(cleaned, 'utf8');
}

function hasValidImageMagicBytes(mime: string, buf: Buffer): boolean {
  if (buf.length < 4) return false;
  switch (mime) {
    case 'image/png':
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case 'image/jpeg':
    case 'image/jpg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/gif':
      return buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a';
    case 'image/webp':
      return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'image/bmp':
      return buf[0] === 0x42 && buf[1] === 0x4d;
    case 'image/svg+xml':
      return /<svg[\s>]/i.test(buf.subarray(0, 512).toString('utf8'));
    default:
      return false;
  }
}

/**
 * Servicio de Almacenamiento Físico de Documentos Asíncrono (Estructura por documento - Opción A).
 *
 * Estructura:
 *   uploads/documents/{noteId}/{docType}.json
 *   uploads/documents/{noteId}/presentation.pptx
 *   uploads/documents/{noteId}/assets/img-{hash}.{ext}
 *
 * Mantiene compatibilidad de lectura con el formato plano legado (`{noteId}_{docType}.json`).
 */
@Injectable()
export class DocumentStorageService implements IDocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly documentsDir = path.resolve(process.cwd(), 'uploads', 'documents');
  private readonly s3Client: S3Client | null = null;
  private readonly pendingWrites = new Map<string, Promise<string>>();
  private readonly bucketName = process.env.R2_BUCKET_NAME || '';
  private readonly publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

  constructor() {
    this.ensureDirectoryExists(this.documentsDir);

    if (
      process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      this.bucketName
    ) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      this.logger.log(`Almacenamiento Cloudflare R2 activado para el bucket: ${this.bucketName}`);
    }
  }

  private assertSafeId(noteId: string): string {
    if (!noteId || !SAFE_ID_RE.test(noteId)) {
      throw new Error('Identificador de documento no válido');
    }
    return noteId;
  }

  private assertSafeDocType(docType: string): string {
    if (!docType || !ALLOWED_DOC_TYPES.has(docType)) {
      throw new Error('Tipo de documento no válido');
    }
    return docType;
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
      } catch (err) {
        this.logger.warn(`No se pudo crear el directorio local ${dirPath}: ${err}`);
      }
    }
  }

  private getDocDir(noteId: string): string {
    return path.join(this.documentsDir, this.assertSafeId(noteId));
  }

  private getDocAssetsDir(noteId: string): string {
    return path.join(this.getDocDir(noteId), 'assets');
  }

  private getDocFilePath(noteId: string, docType: string): string {
    return path.join(this.getDocDir(noteId), `${this.assertSafeDocType(docType)}.json`);
  }

  private getLegacyDocFilePath(noteId: string, docType: string): string {
    return path.join(this.documentsDir, `${this.assertSafeId(noteId)}_${this.assertSafeDocType(docType)}.json`);
  }

  private getDocR2Key(noteId: string, docType: string): string {
    return `uploads/documents/${this.assertSafeId(noteId)}/${this.assertSafeDocType(docType)}.json`;
  }

  private getLegacyDocR2Key(noteId: string, docType: string): string {
    return `uploads/documents/${this.assertSafeId(noteId)}_${this.assertSafeDocType(docType)}.json`;
  }

  private getDocFileUrl(noteId: string, docType: string): string {
    return `/uploads/documents/${this.assertSafeId(noteId)}/${this.assertSafeDocType(docType)}.json`;
  }

  private getPptxFilePath(noteId: string): string {
    return path.join(this.getDocDir(noteId), 'presentation.pptx');
  }

  private getLegacyPptxFilePath(noteId: string): string {
    return path.join(this.documentsDir, `${this.assertSafeId(noteId)}.pptx`);
  }

  private getPptxR2Key(noteId: string): string {
    return `uploads/documents/${this.assertSafeId(noteId)}/presentation.pptx`;
  }

  private getLegacyPptxR2Key(noteId: string): string {
    return `uploads/documents/${this.assertSafeId(noteId)}.pptx`;
  }

  private getPptxFileUrl(noteId: string): string {
    return `/uploads/documents/${this.assertSafeId(noteId)}/presentation.pptx`;
  }

  /**
   * Extrae imágenes embebidas en Base64 (`data:image/...`) dentro del documento
   * y las persiste como archivos binarios en `uploads/documents/{noteId}/assets/` (local + R2).
   */
  private async externalizeInlineImages(noteId: string, data: any): Promise<any> {
    if (!data || typeof data !== 'object') return data;
    const uploadedCache = new Map<string, string>();
    const assetsDir = this.getDocAssetsDir(noteId);
    let dirEnsured = false;

    const persistDataUri = async (mimeRaw: string, b64: string): Promise<string | null> => {
      const mime = mimeRaw.toLowerCase();
      const ext = EXT_BY_MIME[mime];
      if (!ext) return null;

      let buffer: Buffer;
      try {
        buffer = Buffer.from(b64, 'base64');
      } catch {
        return null;
      }
      if (!buffer.length || !hasValidImageMagicBytes(mime, buffer)) return null;
      if (mime === 'image/svg+xml') {
        buffer = sanitizeSvgBuffer(buffer);
      }

      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const filename = `img-${hash}${ext}`;
      if (uploadedCache.has(filename)) return uploadedCache.get(filename)!;

      const r2Key = `uploads/documents/${noteId}/assets/${filename}`;
      const relativeUrl = `/uploads/documents/${noteId}/assets/${filename}`;
      const finalUrl = this.publicUrl ? `${this.publicUrl}/${r2Key}` : relativeUrl;

      if (!dirEnsured) {
        this.ensureDirectoryExists(assetsDir);
        dirEnsured = true;
      }
      const localPath = path.join(assetsDir, filename);
      try {
        if (!fs.existsSync(localPath)) {
          await fs.promises.writeFile(localPath, buffer);
        }
      } catch (err) {
        this.logger.warn(`No se pudo guardar localmente el activo ${filename} de ${noteId}: ${err}`);
      }

      if (this.s3Client && this.bucketName) {
        try {
          await this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.bucketName,
              Key: r2Key,
              Body: buffer,
              ContentType: mime,
              CacheControl: 'public, max-age=31536000, immutable',
            }),
          );
        } catch (err) {
          this.logger.error(`Error subiendo activo ${r2Key} a R2:`, err);
        }
      }

      uploadedCache.set(filename, finalUrl);
      return finalUrl;
    };

    const transformString = async (value: string): Promise<string> => {
      if (!value.includes('data:image/')) return value;
      const matches = Array.from(value.matchAll(INLINE_DATA_IMAGE_RE));
      if (!matches.length) return value;
      let out = value;
      for (const m of matches) {
        const full = m[0];
        const url = await persistDataUri(m[1], m[2]);
        if (url) {
          out = out.split(full).join(url);
        }
      }
      return out;
    };

    const walk = async (node: any): Promise<any> => {
      if (typeof node === 'string') return transformString(node);
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          node[i] = await walk(node[i]);
        }
        return node;
      }
      if (node && typeof node === 'object') {
        for (const key of Object.keys(node)) {
          node[key] = await walk(node[key]);
        }
        return node;
      }
      return node;
    };

    return walk(data);
  }

  /**
   * Guarda de forma asíncrona los datos de un documento especializado (JSON).
   * Extrae imágenes Base64 a `assets/`, persiste en Cloudflare R2 y en disco local.
   */
  async saveDocument(noteId: string, docType: string, data: any): Promise<string> {
    this.assertSafeId(noteId);
    this.assertSafeDocType(docType);
    const snapshot = JSON.stringify(data ?? {});
    const key = `${noteId}:${docType}`;
    const previous = this.pendingWrites.get(key) || Promise.resolve('');
    const operation = previous.catch(() => '').then(() => this.persistDocument(noteId, docType, snapshot));
    this.pendingWrites.set(key, operation);
    try { return await operation; }
    finally { if (this.pendingWrites.get(key) === operation) this.pendingWrites.delete(key); }
  }

  private async persistDocument(noteId: string, docType: string, snapshot: string): Promise<string> {
    const parsed = await this.externalizeInlineImages(noteId, JSON.parse(snapshot));
    const jsonContent = docType === 'sheet'
      ? await encodeSheetDocument(parsed)
      : Buffer.from(JSON.stringify(parsed, null, 2));
    const relativeUrl = this.getDocFileUrl(noteId, docType);
    let r2Saved = false;
    if (this.s3Client && this.bucketName) {
      try {
        await this.s3Client.send(new PutObjectCommand({
          Bucket: this.bucketName,
          Key: this.getDocR2Key(noteId, docType),
          Body: jsonContent,
          ContentType: 'application/json',
        }));
        r2Saved = true;
      } catch (err) { this.logger.error(`Error saving document to R2 ${noteId} (${docType}):`, err); }
    }
    try {
      this.ensureDirectoryExists(this.getDocDir(noteId));
      await writeDocumentAtomically(this.getDocFilePath(noteId, docType), jsonContent);
    } catch (err) {
      if (!r2Saved) {
        this.logger.error(`Error saving physical document ${noteId} (${docType}):`, err);
        throw err;
      }
    }
    return relativeUrl;
  }

  /**
   * Lee un documento especializado intentando primero el layout por carpeta (`{noteId}/{docType}.json`)
   * y haciendo fallback al formato plano legado (`{noteId}_{docType}.json`), en local y R2.
   */
  async readDocument(noteId: string, docType: string): Promise<any> {
    this.assertSafeId(noteId);
    this.assertSafeDocType(docType);
    const decode = (raw: string) => docType === 'sheet' ? decodeSheetDocument(raw) : Promise.resolve(JSON.parse(raw));
    const newPath = this.getDocFilePath(noteId, docType);
    const legacyPath = this.getLegacyDocFilePath(noteId, docType);
    let failure: unknown;

    for (const candidatePath of [newPath, legacyPath]) {
      try {
        return await decode(await fs.promises.readFile(candidatePath, 'utf8'));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          failure = err;
          this.logger.warn(`No se pudo leer localmente ${candidatePath}, continuando...`);
        }
      }
    }

    if (this.s3Client && this.bucketName) {
      for (const r2Key of [this.getDocR2Key(noteId, docType), this.getLegacyDocR2Key(noteId, docType)]) {
        try {
          const response = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: r2Key }));
          if (response.Body) {
            const raw = await response.Body.transformToString('utf-8');
            const parsed = await decode(raw);
            try {
              this.ensureDirectoryExists(this.getDocDir(noteId));
              await writeDocumentAtomically(newPath, raw);
            } catch { /* The verified R2 copy is still readable. */ }
            return parsed;
          }
        } catch (err) {
          const missing =
            (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name === 'NoSuchKey' ||
            (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
          if (!missing) {
            failure = err;
            this.logger.error(`Error reading document from R2 ${r2Key}:`, err);
          }
        }
      }
    }

    if (failure) throw new Error(`No se pudo leer el documento ${noteId} (${docType}).`, { cause: failure });
    return null;
  }

  /**
   * Guarda de forma asíncrona un archivo PowerPoint binario (.pptx) decodificando el base64.
   */
  async savePptx(noteId: string, base64: string): Promise<string> {
    this.assertSafeId(noteId);
    if (!base64) return '';

    const buffer = Buffer.from(base64, 'base64');
    const relativeUrl = this.getPptxFileUrl(noteId);
    let r2Saved = false;

    if (this.s3Client && this.bucketName) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: this.getPptxR2Key(noteId),
            Body: buffer,
            ContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          }),
        );
        r2Saved = true;
      } catch (err) {
        this.logger.error(`Error saving PPTX to R2 ${noteId}:`, err);
      }
    }

    try {
      this.ensureDirectoryExists(this.getDocDir(noteId));
      await fs.promises.writeFile(this.getPptxFilePath(noteId), buffer);
    } catch (err) {
      if (!r2Saved) {
        this.logger.error(`Error saving physical PPTX ${noteId}:`, err);
        return '';
      }
    }

    return relativeUrl;
  }

  /**
   * Lee de forma asíncrona el archivo PowerPoint y lo convierte a base64.
   */
  async readPptxBase64(noteId: string): Promise<string | null> {
    this.assertSafeId(noteId);
    const newPath = this.getPptxFilePath(noteId);
    const legacyPath = this.getLegacyPptxFilePath(noteId);

    for (const filePath of [newPath, legacyPath]) {
      try {
        const buffer = await fs.promises.readFile(filePath);
        return buffer.toString('base64');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`No se pudo leer localmente PPTX ${filePath}, consultando R2...`);
        }
      }
    }

    if (this.s3Client && this.bucketName) {
      for (const key of [this.getPptxR2Key(noteId), this.getLegacyPptxR2Key(noteId)]) {
        try {
          const response = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
          if (response.Body) {
            const bytes = await response.Body.transformToByteArray();
            const base64 = Buffer.from(bytes).toString('base64');
            try {
              this.ensureDirectoryExists(this.getDocDir(noteId));
              await fs.promises.writeFile(newPath, Buffer.from(bytes));
            } catch {}
            return base64;
          }
        } catch (err) {
          const missing =
            (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name === 'NoSuchKey' ||
            (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
          if (!missing) {
            this.logger.error(`Error reading PPTX from R2 ${key}:`, err);
          }
        }
      }
    }

    return null;
  }

  /**
   * Elimina la carpeta completa del documento (JSON + assets/imágenes + PPTX)
   * y cualquier archivo legado tanto en disco local como en Cloudflare R2.
   */
  async deleteDocument(noteId: string, docType?: string): Promise<void> {
    this.assertSafeId(noteId);
    // 1. Limpieza local: carpeta completa del documento + archivos legados
    try {
      await fs.promises.rm(this.getDocDir(noteId), { recursive: true, force: true });
      const types = docType && ALLOWED_DOC_TYPES.has(docType) ? [docType] : ['sheet', 'doc', 'canvas', 'slide'];
      for (const t of types) {
        await this.safeUnlink(this.getLegacyDocFilePath(noteId, t));
      }
      await this.safeUnlink(this.getLegacyPptxFilePath(noteId));
    } catch (err) {
      this.logger.error(`Error deleting physical files for note ${noteId}:`, err);
    }

    // 2. Limpieza en Cloudflare R2: todo el prefijo `uploads/documents/{noteId}/` + claves legadas
    if (this.s3Client && this.bucketName) {
      try {
        let continuationToken: string | undefined;
        do {
          const listed = await this.s3Client.send(
            new ListObjectsV2Command({
              Bucket: this.bucketName,
              Prefix: `uploads/documents/${noteId}/`,
              ContinuationToken: continuationToken,
            }),
          );
          const objects = (listed.Contents || [])
            .map((item) => item.Key)
            .filter((k): k is string => Boolean(k))
            .map((Key) => ({ Key }));
          if (objects.length) {
            await this.s3Client.send(
              new DeleteObjectsCommand({
                Bucket: this.bucketName,
                Delete: { Objects: objects, Quiet: true },
              }),
            );
          }
          continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
        } while (continuationToken);
      } catch (err) {
        this.logger.warn(`No se pudo limpiar el prefijo R2 uploads/documents/${noteId}/:`, err);
      }

      const legacyKeys: string[] = [];
      if (docType && ALLOWED_DOC_TYPES.has(docType)) {
        if (docType === 'slide') legacyKeys.push(this.getLegacyPptxR2Key(noteId));
        legacyKeys.push(this.getLegacyDocR2Key(noteId, docType));
      } else {
        for (const t of ['sheet', 'doc', 'canvas']) legacyKeys.push(this.getLegacyDocR2Key(noteId, t));
        legacyKeys.push(this.getLegacyPptxR2Key(noteId));
      }

      for (const key of legacyKeys) {
        try {
          await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
        } catch (err) {
          this.logger.warn(`No se pudo eliminar de R2 la clave ${key}:`, err);
        }
      }
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Ignorar si ya no existe
    }
  }
}
