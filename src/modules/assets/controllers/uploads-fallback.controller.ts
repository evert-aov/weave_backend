import { Controller, Get, Param, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'node:path';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const BLOCKED_PUBLIC_EXT_RE = /\.(?:json|pptx)$/i;

/**
 * Sirve activos públicos (imágenes/adjuntos) desde disco local con fallback a R2.
 * Los payloads privados de documentos (`.json`, `.pptx`) NUNCA se exponen por esta ruta pública:
 * solo se accede a ellos vía endpoints autenticados (`/api/notes/:id/document`).
 */
@Controller('uploads')
export class UploadsFallbackController {
  private readonly publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  private readonly uploadsDir = path.resolve(process.cwd(), 'uploads');

  @Get(':filename')
  handleUploadFallback(@Param('filename') filename: string, @Res() res: Response): void {
    this.serveSafeAsset(this.uploadsDir, filename, `uploads/${encodeURIComponent(filename)}`, res);
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
    const r2Path = `uploads/documents/${encodeURIComponent(noteId)}/assets/${encodeURIComponent(filename)}`;
    this.serveSafeAsset(rootDir, filename, r2Path, res);
  }

  @Get('documents/:filename')
  blockPrivateDocumentAccess(@Res() res: Response): void {
    res.status(HttpStatus.FORBIDDEN).send('Document payloads require authentication');
  }

  private serveSafeAsset(rootDir: string, filename: string, r2RelativePath: string, res: Response): void {
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

    const missing = () => {
      if (this.publicUrl) {
        res.redirect(HttpStatus.FOUND, `${this.publicUrl}/${r2RelativePath}`);
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
        if (status === HttpStatus.NOT_FOUND || failure.code === 'ENOENT') missing();
        else res.status(status && status >= 400 && status <= 599 ? status : HttpStatus.INTERNAL_SERVER_ERROR).end();
      },
    );
  }
}
