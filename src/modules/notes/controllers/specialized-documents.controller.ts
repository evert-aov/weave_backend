import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { NotesRepository } from '../repositories/notes.repository';
import { SpecializedDocumentsService } from '../services/specialized-documents.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

/**
 * Controlador de Documentos Especializados (Word, Excel, Slide, Canvas).
 * Expone endpoints REST dedicados bajo /api/notes/:id/document
 * para interactuar directamente con la carga útil del documento especializado.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/notes/:id/document')
export class SpecializedDocumentsController {
  constructor(
    private readonly notesRepository: NotesRepository,
    private readonly specializedDocumentsService: SpecializedDocumentsService,
  ) {}

  /**
   * Obtiene la carga útil física (docData) de un documento especializado.
   */
  @Get()
  async getDocument(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    if (!note.docType || note.docType === 'block') {
      return {
        docType: 'block',
        docUrl: null,
        docData: null,
      };
    }

    const docData = await this.specializedDocumentsService.readSpecializedDocument(
      id,
      note.docType,
    );

    return {
      noteId: id,
      docType: note.docType,
      docUrl: note.docUrl,
      docData,
    };
  }

  /**
   * Actualiza el contenido especializado en disco y actualiza metadatos en MongoDB si aplica.
   */
  @Put()
  async updateDocument(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body('docData') docData: any,
  ) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    const docType = note.docType || 'doc';
    const { docUrl, memoryDocData } =
      await this.specializedDocumentsService.updateSpecializedDocument(
        id,
        docType,
        docData,
        note.title,
      );

    if (docUrl && docUrl !== note.docUrl) {
      await this.notesRepository.update(id, userId, { docUrl });
    }

    return {
      noteId: id,
      docType,
      docUrl: docUrl || note.docUrl,
      docData: memoryDocData,
    };
  }
}
