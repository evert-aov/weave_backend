import { Controller, Get, Param, Res, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const BLOCKED_PUBLIC_EXT_RE = /\.(?:json|pptx)$/i;

/**
 * Sirve activos públicos (imágenes/adjuntos) desde disco local con fallback directo desde R2.
 * Cuando R2 está configurado, retransmite los bytes con HTTP 200 (evitando redirecciones 302
 * cross-origin que rompen fetch() en exportaciones PDF/DOCX).
 * Los payloads privados de documentos (`.json`, `.pptx`) NUNCA se exponen por esta ruta pública.
 */
@Controller('uploads')
export class UploadsFallbackController {
  private readonly logger = new Logger(UploadsFallbackController.name);
  private readonly publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  private readonly uploadsDir = path.resolve(process.cwd(), 'uploads');
  private readonly bucketName = process.env.R2_BUCKET_NAME || '';
  private readonly s3Client: S3Client | null = null;

  constructor() {
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
    }
  }

  @Get(':filename')
  handleUploadFallback(@Param('filename') filename: string, @Res() res: Response): void {
    this.serveSafeAsset(this.uploadsDir, filename, `uploads/${filename}`, `uploads/${encodeURIComponent(filename)}`, res);
  }

  @Get('documents/:noteId/assets/:filename')
  handleDocumentAssetFallback(
    @Param('noteId') noteId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): void {
    if (!SAFE_ID_RE.test(noteId)) {
      res.status(HttpStatus.NOT_FOUND).send('Asset not found');
      return;
    }
    const rootDir = path.join(this.uploadsDir, 'documents', noteId, 'assets');
    const r2Key = `uploads/documents/${noteId}/assets/${filename}`;
    const r2EncodedPath = `uploads/documents/${encodeURIComponent(noteId)}/assets/${encodeURIComponent(filename)}`;
    this.serveSafeAsset(rootDir, filename, r2Key, r2EncodedPath, res);
  }

  @Get('documents/:filename')
  blockPrivateDocumentAccess(@Res() res: Response): void {
    res.status(HttpStatus.FORBIDDEN).send('Document payloads require authentication');
  }

  private serveSafeAsset(
    rootDir: string,
    filename: string,
    r2Key: string,
    r2EncodedPath: string,
    res: Response,
  ): void {
    if (
      !filename ||
      filename.startsWith('.') ||
      filename.includes('\\') ||
      path.basename(filename) !== filename ||
      BLOCKED_PUBLIC_EXT_RE.test(filename)
    ) {
      res.status(HttpStatus.NOT_FOUND).send('Asset not found');
      return;
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (/\.svg$/i.test(filename)) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }

    const handleMissing = async () => {
      if (this.s3Client && this.bucketName) {
        try {
          const response = await this.s3Client.send(
            new GetObjectCommand({ Bucket: this.bucketName, Key: r2Key }),
          );
          if (response.Body) {
            const bytes = await response.Body.transformToByteArray();
            if (response.ContentType) res.setHeader('Content-Type', response.ContentType);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.status(HttpStatus.OK).send(Buffer.from(bytes));
            return;
          }
        } catch (err) {
          const missing =
            (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name === 'NoSuchKey' ||
            (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
          if (!missing) {
            this.logger.warn(`Error streaming ${r2Key} from R2:`, err);
          }
        }
      }

      if (this.publicUrl) {
        res.redirect(HttpStatus.FOUND, `${this.publicUrl}/${r2EncodedPath}`);
      } else {
        res.status(HttpStatus.NOT_FOUND).send('Asset not found');
      }
    };

    res.sendFile(
      filename,
      {
        root: rootDir,
        dotfiles: 'deny',
      },
      (error) => {
        if (!error || res.headersSent) return;
        const failure = error as NodeJS.ErrnoException & { status?: number; statusCode?: number };
        const status = failure.statusCode || failure.status;
        if (status === HttpStatus.NOT_FOUND || failure.code === 'ENOENT') {
          void handleMissing();
        } else {
          res.status(status && status >= 400 && status <= 599 ? status : HttpStatus.INTERNAL_SERVER_ERROR).end();
        }
      },
    );
  }
}
