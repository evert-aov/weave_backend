import { BadRequestException, Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Servicio para gestión y almacenamiento físico de activos (imágenes y archivos) en disco.
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
   * Procesa los metadatos de un archivo subido vía multipart/form-data y genera su URL pública accesible.
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

  /**
   * Decodifica una imagen en formato base64 / Data URL y la persiste físicamente en disco en el directorio uploads.
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

    // Comprobar formato Data URL: data:image/...;base64,...
    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let mimeType = 'image/png';
    let buffer: Buffer;

    if (matches && matches.length === 3) {
      mimeType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      // Si se envía base64 puro sin prefijo data:
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

    await fs.promises.writeFile(filePath, buffer);

    const fileUrl = reqBaseUrl ? `${reqBaseUrl}/uploads/${filename}` : `/uploads/${filename}`;
    return {
      url: fileUrl,
      filename,
      mimeType,
      size: buffer.length,
    };
  }
}
