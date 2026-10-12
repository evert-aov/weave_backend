import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Note, NoteSchema } from './entities/note.entity';
import { NotesRepository } from './repositories/notes.repository';
import { NotesService } from './services/notes.service';
import { NotesController } from './controllers/notes.controller';

/**
 * Módulo de Notas.
 * Conecta el esquema de Mongoose, el repositorio, servicio y controlador de documentos.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Note.name, schema: NoteSchema }]),
  ],
  controllers: [NotesController],
  providers: [NotesRepository, NotesService],
  exports: [NotesRepository, NotesService],
})
export class NotesModule {}
