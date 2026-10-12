import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Servicio para gestión y almacenamiento de activos (imágenes y archivos).
 */
@Injectable()
export class AssetsService {
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads');

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Procesa los metadatos de un archivo subido y genera su URL pública accesible.
   */
  processUploadedFile(file: Express.Multer.File, reqBaseUrl: string) {
    const fileUrl = `${reqBaseUrl}/uploads/${file.filename}`;
    return {
      url: fileUrl,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }
}
