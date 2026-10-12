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
          cb(null, `file-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedExts = /\.(jpg|jpeg|png|gif|webp|svg|pdf|doc|docx|xls|xlsx|ppt|pptx)$/i;
        const ext = path.extname(file.originalname);
        if (
          !file.mimetype.match(
            /^(image\/(jpeg|png|gif|webp|svg\+xml)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel|vnd\.ms-powerpoint))$/i,
          ) &&
          !allowedExts.test(ext)
        ) {
          return cb(
            new BadRequestException(
              'Unsupported file type. Only JPG, PNG, WEBP, GIF, SVG, PDF, Word (.doc, .docx), Excel (.xls, .xlsx), and PowerPoint (.ppt, .pptx) are allowed.',
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 50 * 1024 * 1024, // Límite máximo de 50 MB
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
