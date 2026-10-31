import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { NoteBlocksService } from '../services/note-blocks.service';
import { CreateBlockDto, UpdateBlockDto, ReorderBlocksDto } from '../dto/block.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

/**
 * Controlador de Bloques de Notas.
 * Expone endpoints REST dedicados bajo la sub-ruta /api/notes/:id/blocks
 * garantizando la segregación de interfaces (ISP) respecto al ciclo de vida general del documento.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/notes/:id/blocks')
export class NoteBlocksController {
  constructor(private readonly noteBlocksService: NoteBlocksService) {}

  /**
   * Agrega un nuevo bloque a una nota.
   */
  @Post()
  async addBlock(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() createBlockDto: CreateBlockDto,
  ) {
    return this.noteBlocksService.addBlock(id, userId, createBlockDto);
  }

  /**
   * Actualiza un bloque existente dentro de una nota.
   */
  @Patch(':blockId')
  async updateBlock(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('blockId') blockId: string,
    @Body() updateBlockDto: UpdateBlockDto,
  ) {
    return this.noteBlocksService.updateBlock(id, blockId, userId, updateBlockDto);
  }

  /**
   * Elimina un bloque dentro de una nota.
   */
  @Delete(':blockId')
  async removeBlock(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('blockId') blockId: string,
  ) {
    return this.noteBlocksService.removeBlock(id, blockId, userId);
  }

  /**
   * Reordena los bloques de una nota.
   */
  @Put('reorder')
  async reorderBlocks(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() reorderDto: ReorderBlocksDto,
  ) {
    return this.noteBlocksService.reorderBlocks(id, userId, reorderDto);
  }
}
