import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SAFE_NOTE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function sanitizeSvg(buffer: Buffer): Buffer {
  const cleaned = buffer
    .toString('utf8')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:iframe|object|embed|foreignObject)\b[\s\S]*?<\/(?:iframe|object|embed|foreignObject)>/gi, '')
    .replace(/<(?:iframe|object|embed|foreignObject)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');
  return Buffer.from(cleaned, 'utf8');
}

function validateFileSignature(mimeType: string, ext: string, buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const m = mimeType.toLowerCase();
  const e = ext.toLowerCase();
  if (m === 'image/png' || e === '.png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (m === 'image/jpeg' || m === 'image/jpg' || e === '.jpg' || e === '.jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (m === 'image/gif' || e === '.gif') {
    const hdr = buffer.subarray(0, 6).toString('ascii');
    return hdr === 'GIF87a' || hdr === 'GIF89a';
  }
  if (m === 'image/webp' || e === '.webp') {
    return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (m === 'image/bmp' || e === '.bmp') {
    return buffer[0] === 0x42 && buffer[1] === 0x4d;
  }
  if (m === 'image/svg+xml' || e === '.svg') {
    return /<svg[\s>]/i.test(buffer.subarray(0, 512).toString('utf8'));
  }
  if (m === 'application/pdf' || e === '.pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (e === '.docx' || e === '.xlsx' || e === '.pptx') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  }
  if (e === '.doc' || e === '.xls' || e === '.ppt') {
    return buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  }
  return false;
}

/**
 * Servicio para gestión y almacenamiento físico de activos (imágenes y archivos)
 * en disco local y/o en Cloudflare R2 (S3 compatible).
 *
 * Cuando se recibe `noteId`, los activos se almacenan dentro de la carpeta del documento:
 *   `uploads/documents/{noteId}/assets/{filename}`
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads');
  private readonly s3Client: S3Client | null = null;
  private readonly bucketName = process.env.R2_BUCKET_NAME || '';
  private readonly publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      try {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      } catch (err) {
        this.logger.warn(`No se pudo crear el directorio de subidas local: ${err}`);
      }
    }

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
      this.logger.log(`AssetsService: Cloudflare R2 configurado para ${this.bucketName}`);
    }
  }

  private resolveSafeNoteId(noteId?: string): string | null {
    if (!noteId || typeof noteId !== 'string') return null;
    const trimmed = noteId.trim();
    if (!trimmed) return null;
    if (!SAFE_NOTE_ID_RE.test(trimmed)) {
      throw new BadRequestException('noteId inválido');
    }
    return trimmed;
  }

  private buildAssetTarget(filename: string, noteId?: string): {
    localDir: string;
    localPath: string;
    r2Key: string;
    relativeUrl: string;
  } {
    const safeNoteId = this.resolveSafeNoteId(noteId);
    if (safeNoteId) {
      const localDir = path.resolve(this.uploadDir, 'documents', safeNoteId, 'assets');
      return {
        localDir,
        localPath: path.join(localDir, filename),
        r2Key: `uploads/documents/${safeNoteId}/assets/${filename}`,
        relativeUrl: `/uploads/documents/${safeNoteId}/assets/${filename}`,
      };
    }
    return {
      localDir: this.uploadDir,
      localPath: path.resolve(this.uploadDir, filename),
      r2Key: `uploads/${filename}`,
      relativeUrl: `/uploads/${filename}`,
    };
  }

  /**
   * Procesa un archivo subido vía multipart/form-data, valida su firma binaria,
   * lo mueve a la carpeta del documento si corresponde y lo replica en Cloudflare R2.
   */
  async processUploadedFile(file: Express.Multer.File, reqBaseUrl: string, noteId?: string) {
    const ext = path.extname(file.filename || file.originalname || '').toLowerCase();
    let buffer: Buffer = await fs.promises.readFile(file.path);

    if (!validateFileSignature(file.mimetype || '', ext, buffer)) {
      await fs.promises.unlink(file.path).catch(() => {});
      throw new BadRequestException('El contenido del archivo no coincide con un formato permitido.');
    }

    if (file.mimetype === 'image/svg+xml' || ext === '.svg') {
      buffer = sanitizeSvg(buffer);
      await fs.promises.writeFile(file.path, buffer);
    }

    const target = this.buildAssetTarget(file.filename, noteId);
    if (target.localPath !== path.resolve(file.path)) {
      await fs.promises.mkdir(target.localDir, { recursive: true });
      await fs.promises.rename(file.path, target.localPath);
    }

    if (this.s3Client && this.bucketName) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: target.r2Key,
            Body: buffer,
            ContentLength: buffer.length,
            ContentType: file.mimetype || 'application/octet-stream',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      } catch (err) {
        this.logger.error(`Error al subir archivo ${target.r2Key} a R2:`, err);
      }
    }

    const fileUrl = this.publicUrl
      ? `${this.publicUrl}/${target.r2Key}`
      : reqBaseUrl
      ? `${reqBaseUrl}${target.relativeUrl}`
      : target.relativeUrl;

    return {
      url: fileUrl,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: buffer.length,
    };
  }

  /**
   * Decodifica una imagen en formato base64 / Data URL y la persiste en disco y/o R2.
   * Si se proporciona `noteId`, la almacena en `uploads/documents/{noteId}/assets/`.
   */
  async uploadBase64Image(
    dataUrl: string,
    originalName?: string,
    reqBaseUrl: string = '',
    noteId?: string,
  ): Promise<{
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    if (!dataUrl || typeof dataUrl !== 'string') {
      throw new BadRequestException('Data URL de imagen no proporcionada o inválida');
    }

    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let mimeType = 'image/png';
    let buffer: Buffer;

    if (matches && matches.length === 3) {
      mimeType = matches[1].toLowerCase();
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      try {
        buffer = Buffer.from(dataUrl, 'base64');
      } catch {
        throw new BadRequestException('Cadena base64 corrupta o ilegible');
      }
    }

    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp',
    };

    const ext = extMap[mimeType];
    if (!ext || !validateFileSignature(mimeType, ext, buffer)) {
      throw new BadRequestException('Formato de imagen inválido o no permitido');
    }

    if (mimeType === 'image/svg+xml') {
      buffer = sanitizeSvg(buffer);
    }

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `img-${uniqueSuffix}${ext}`;
    const target = this.buildAssetTarget(filename, noteId);

    try {
      await fs.promises.mkdir(target.localDir, { recursive: true });
      await fs.promises.writeFile(target.localPath, buffer);
    } catch (err) {
      this.logger.warn(`No se pudo escribir localmente la imagen ${filename}: ${err}`);
    }

    if (this.s3Client && this.bucketName) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: target.r2Key,
            Body: buffer,
            ContentLength: buffer.length,
            ContentType: mimeType,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      } catch (err) {
        this.logger.error(`Error al subir imagen base64 ${target.r2Key} a R2:`, err);
      }
    }

    const fileUrl = this.publicUrl
      ? `${this.publicUrl}/${target.r2Key}`
      : reqBaseUrl
      ? `${reqBaseUrl}${target.relativeUrl}`
      : target.relativeUrl;

    return {
      url: fileUrl,
      filename,
      mimeType,
      size: buffer.length,
    };
  }
}
