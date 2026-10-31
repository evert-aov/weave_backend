import { Module } from '@nestjs/common';
import { AssetsController } from './controllers/assets.controller';
import { UploadsFallbackController } from './controllers/uploads-fallback.controller';
import { AssetsService } from './services/assets.service';

/**
 * Módulo de Activos Multimedia de Weave.
 */
@Module({
  controllers: [AssetsController, UploadsFallbackController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
