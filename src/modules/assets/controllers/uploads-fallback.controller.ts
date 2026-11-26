import { Controller, Get, Param, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'node:path';

/** Local uploads take precedence over the optional public R2 fallback. */
@Controller('uploads')
export class UploadsFallbackController {
  private readonly publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  private readonly uploadsDir = path.resolve(process.cwd(), 'uploads');

  @Get(':filename')
  handleUploadFallback(@Param('filename') filename: string, @Res() res: Response): void {
    this.serveFile(filename, false, res);
  }

  @Get('documents/:filename')
  handleDocumentFallback(@Param('filename') filename: string, @Res() res: Response): void {
    this.serveFile(filename, true, res);
  }

  private serveFile(filename: string, document: boolean, res: Response): void {
    const missing = () => {
      if (this.publicUrl) {
        res.redirect(HttpStatus.FOUND, `${this.publicUrl}/uploads/${document ? 'documents/' : ''}${encodeURIComponent(filename)}`);
      } else {
        res.status(HttpStatus.NOT_FOUND).send(document ? 'Document not found' : 'Asset not found');
      }
    };
    if (!filename || filename.startsWith('.') || filename.includes('\\') || path.basename(filename) !== filename) {
      res.status(HttpStatus.NOT_FOUND).send('Asset not found'); return;
    }
    // Controller routes may run before the static-file middleware.
    res.sendFile(filename, {
      root: document ? path.join(this.uploadsDir, 'documents') : this.uploadsDir,
      dotfiles: 'deny',
    }, error => {
      if (!error || res.headersSent) return;
      const failure = error as NodeJS.ErrnoException & { status?: number; statusCode?: number };
      const status = failure.statusCode || failure.status;
      if (status === HttpStatus.NOT_FOUND || failure.code === 'ENOENT') missing();
      else res.status(status && status >= 400 && status <= 599 ? status : HttpStatus.INTERNAL_SERVER_ERROR).end();
    });
  }
}
