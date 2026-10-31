import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Servicio para gestión y almacenamiento físico de activos (imágenes y archivos)
 * en disco local y/o en Cloudflare R2 (S3 compatible).
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads');
  private readonly s3Client: S3Client | null = null;
  private readonly bucketName = process.env.R2_BUCKET_NAME || '';
  private readonly publicUrl = process.env.R2_PUBLIC_URL || '';

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

  /**
   * Procesa los metadatos de un archivo subido vía multipart/form-data,
   * lo replica en Cloudflare R2 si está configurado y genera su URL accesible.
   */
  async processUploadedFile(file: Express.Multer.File, reqBaseUrl: string) {
    // Si R2 está activo, subir a la nube
    if (this.s3Client && this.bucketName && file?.path) {
      try {
        const stream = fs.createReadStream(file.path);
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: `uploads/${file.filename}`,
            Body: stream,
            ContentLength: file.size,
            ContentType: file.mimetype || 'application/octet-stream',
          }),
        );
      } catch (err) {
        this.logger.error(`Error al subir archivo ${file.filename} a R2:`, err);
      }
    }

    const fileUrl = this.publicUrl
      ? `${this.publicUrl}/uploads/${file.filename}`
      : reqBaseUrl
      ? `${reqBaseUrl}/uploads/${file.filename}`
      : `/uploads/${file.filename}`;

    return {
      url: fileUrl,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  /**
   * Decodifica una imagen en formato base64 / Data URL y la persiste en disco y/o R2.
   * Devuelve la URL accesible pública para que el documento mantenga una referencia física persistente.
   */
  async uploadBase64Image(
    dataUrl: string,
    originalName?: string,
    reqBaseUrl: string = '',
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
      mimeType = matches[1];
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

    const ext = extMap[mimeType.toLowerCase()] || '.png';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `img-${uniqueSuffix}${ext}`;
    const filePath = path.resolve(this.uploadDir, filename);

    // 1. Guardar en disco local si es accesible
    try {
      await fs.promises.writeFile(filePath, buffer);
    } catch (err) {
      this.logger.warn(`No se pudo escribir localmente la imagen ${filename}: ${err}`);
    }

    // 2. Guardar en Cloudflare R2
    if (this.s3Client && this.bucketName) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: `uploads/${filename}`,
            Body: buffer,
            ContentLength: buffer.length,
            ContentType: mimeType,
          }),
        );
      } catch (err) {
        this.logger.error(`Error al subir imagen base64 ${filename} a R2:`, err);
      }
    }

    const fileUrl = this.publicUrl
      ? `${this.publicUrl}/uploads/${filename}`
      : reqBaseUrl
      ? `${reqBaseUrl}/uploads/${filename}`
      : `/uploads/${filename}`;

    return {
      url: fileUrl,
      filename,
      mimeType,
      size: buffer.length,
    };
  }
}
