import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Space, SpaceSchema } from './entities/space.entity';
import { Note, NoteSchema } from '../notes/entities/note.entity';
import { SpacesRepository } from './repositories/spaces.repository';
import { SpacesService } from './services/spaces.service';
import { SpacesController } from './controllers/spaces.controller';

/**
 * Módulo de Espacios (Directorios) de Weave.
 * Conecta el esquema de Mongoose, repositorio, servicio y controlador REST.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Space.name, schema: SpaceSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
  ],
  controllers: [SpacesController],
  providers: [SpacesRepository, SpacesService],
  exports: [SpacesRepository, SpacesService],
})
export class SpacesModule {}
