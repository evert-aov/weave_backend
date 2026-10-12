import { Module } from '@nestjs/common';
import { AssetsController } from './controllers/assets.controller';
import { AssetsService } from './services/assets.service';

/**
 * Módulo de Activos Multimedia de Weave.
 */
@Module({
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
