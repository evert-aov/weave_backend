import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotesController } from './controllers/notes.controller';
import { NoteBlocksController } from './controllers/note-blocks.controller';
import { SpecializedDocumentsController } from './controllers/specialized-documents.controller';
import { NotesService } from './services/notes.service';
import { NoteBlocksService } from './services/note-blocks.service';
import { SpecializedDocumentsService } from './services/specialized-documents.service';
import { NotesRepository } from './repositories/notes.repository';
import { DocumentStorageService } from './services/document-storage.service';
import { Note, NoteSchema } from './entities/note.entity';
import { SpacesModule } from '../spaces/spaces.module';

/**
 * Módulo de Notas y Documentos de Weave.
 * Arquitectura modular de Alta Cohesión:
 * - NotesController: Ciclo de vida general de notas y espacios.
 * - NoteBlocksController: Sub-recursos de bloques para documentos interactivos.
 * - SpecializedDocumentsController: Carga útil y persistencia directa de documentos puros.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Note.name, schema: NoteSchema }]),
    SpacesModule,
  ],
  controllers: [
    NotesController,
    NoteBlocksController,
    SpecializedDocumentsController,
  ],
  providers: [
    NotesService,
    NoteBlocksService,
    SpecializedDocumentsService,
    NotesRepository,
    DocumentStorageService,
  ],
  exports: [
    NotesService,
    NoteBlocksService,
    SpecializedDocumentsService,
    NotesRepository,
  ],
})
export class NotesModule {}
