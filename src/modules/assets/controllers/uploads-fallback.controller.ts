import { Controller, Get, Param, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Controlador de Respaldo para Activos en /uploads.
 * Si un archivo solicitado no existe en el disco local (por ejemplo en entornos efímeros de Koyeb),
 * redirige automáticamente a la CDN pública de Cloudflare R2 con código 302.
 */
@Controller('uploads')
export class UploadsFallbackController {
  private readonly publicUrl = process.env.R2_PUBLIC_URL || '';

  @Get(':filename')
  handleUploadFallback(@Param('filename') filename: string, @Res() res: Response) {
    if (this.publicUrl) {
      return res.redirect(HttpStatus.FOUND, `${this.publicUrl}/uploads/${filename}`);
    }
    return res.status(HttpStatus.NOT_FOUND).send('Asset not found');
  }

  @Get('documents/:filename')
  handleDocumentFallback(@Param('filename') filename: string, @Res() res: Response) {
    if (this.publicUrl) {
      return res.redirect(HttpStatus.FOUND, `${this.publicUrl}/uploads/documents/${filename}`);
    }
    return res.status(HttpStatus.NOT_FOUND).send('Document not found');
  }
}
