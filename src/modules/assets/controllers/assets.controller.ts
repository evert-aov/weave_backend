import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import type { Request } from 'express';
import { AssetsService } from '../services/assets.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

/**
 * Controlador de Activos.
 * Endpoint para subir imágenes y archivos desde el bloque de imagen de Weave.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * Sube una imagen (PNG, JPG, WEBP, GIF, SVG) y devuelve la URL accesible.
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, path.resolve(process.cwd(), 'uploads'));
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = path.extname(file.originalname);
          cb(null, `img-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp|svg\+xml)$/)) {
          return cb(
            new BadRequestException(
              'Unsupported file type. Only JPG, PNG, WEBP, GIF, and SVG are allowed.',
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // Límite máximo de 10 MB
      },
    }),
  )
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided for upload');
    }
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    return this.assetsService.processUploadedFile(file, baseUrl);
  }
}
