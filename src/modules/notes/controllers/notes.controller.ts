import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotesService } from '../services/notes.service';
import { CreateNoteDto, UpdateNoteDto } from '../dto/note.dto';
import { CreateBlockDto, UpdateBlockDto, ReorderBlocksDto } from '../dto/block.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

/**
 * Controlador de Notas.
 * Expone endpoints REST protegidos para el ciclo de vida completo de documentos y bloques.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  /**
   * Obtiene la lista de notas del usuario actual, opcionalmente filtradas por espacio.
   */
  @Get()
  async getNotes(
    @CurrentUser('id') userId: string,
    @Query('space') space?: string,
  ) {
    return this.notesService.getNotes(userId, space);
  }

  /**
   * Crea una nueva nota para el usuario actual.
   */
  @Post()
  async createNote(
    @CurrentUser('id') userId: string,
    @Body() createNoteDto: CreateNoteDto,
  ) {
    return this.notesService.createNote(userId, createNoteDto);
  }

  /**
   * Obtiene un documento específico con todos sus bloques.
   */
  @Get(':id')
  async getNoteById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.notesService.getNoteById(id, userId);
  }

  /**
   * Actualiza el documento completo o sus bloques.
   */
  @Put(':id')
  async updateNote(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() updateNoteDto: UpdateNoteDto,
  ) {
    return this.notesService.updateNote(id, userId, updateNoteDto);
  }

  /**
   * Elimina un documento de nota.
   */
  @Delete(':id')
  async deleteNote(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.notesService.deleteNote(id, userId);
  }

  /**
   * Agrega un nuevo bloque a una nota.
   */
  @Post(':id/blocks')
  async addBlock(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() createBlockDto: CreateBlockDto,
  ) {
    return this.notesService.addBlock(id, userId, createBlockDto);
  }

  /**
   * Actualiza un bloque existente dentro de una nota.
   */
  @Patch(':id/blocks/:blockId')
  async updateBlock(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('blockId') blockId: string,
    @Body() updateBlockDto: UpdateBlockDto,
  ) {
    return this.notesService.updateBlock(id, blockId, userId, updateBlockDto);
  }

  /**
   * Elimina un bloque dentro de una nota.
   */
  @Delete(':id/blocks/:blockId')
  async removeBlock(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('blockId') blockId: string,
  ) {
    return this.notesService.removeBlock(id, blockId, userId);
  }

  /**
   * Reordena los bloques de una nota.
   */
  @Put(':id/blocks/reorder')
  async reorderBlocks(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() reorderDto: ReorderBlocksDto,
  ) {
    return this.notesService.reorderBlocks(id, userId, reorderDto);
  }
}
