import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SpacesRepository } from '../repositories/spaces.repository';
import { CreateSpaceDto, UpdateSpaceDto } from '../dto/space.dto';
import { Note, NoteDocument } from '../../notes/entities/note.entity';

/**
 * Servicio de Gestión de Espacios (Directorios).
 * Gestiona el ciclo de vida de los directorios y la inicialización predeterminada.
 */
@Injectable()
export class SpacesService {
  constructor(
    private readonly spacesRepository: SpacesRepository,
    @InjectModel(Note.name)
    private readonly noteModel: Model<NoteDocument>,
  ) {}

  /**
   * Obtiene todos los espacios del usuario. Si el usuario aún no tiene espacios,
   * crea automáticamente los espacios iniciales en MongoDB.
   */
  async getSpaces(userId: string) {
    let spaces = await this.spacesRepository.findAllByUser(userId);
    if (spaces.length === 0) {
      // Sembrar espacios iniciales en la base de datos
      const defaultA = await this.spacesRepository.create({
        userId: new Types.ObjectId(userId) as any,
        name: 'Research',
        color: 'indigo',
        icon: 'folder',
      });
      const defaultB = await this.spacesRepository.create({
        userId: new Types.ObjectId(userId) as any,
        name: 'Personal',
        color: 'teal',
        icon: 'folder',
      });
      spaces = [defaultA, defaultB];
    }
    return spaces;
  }

  /**
   * Crea un nuevo espacio/directorio en MongoDB.
   */
  async createSpace(userId: string, createSpaceDto: CreateSpaceDto) {
    return this.spacesRepository.create({
      userId: new Types.ObjectId(userId) as any,
      name: createSpaceDto.name.trim(),
      color: createSpaceDto.color || 'indigo',
      icon: createSpaceDto.icon || 'folder',
    });
  }

  /**
   * Actualiza el nombre o propiedades de un espacio existente.
   * Si el nombre del espacio cambia, sincroniza automáticamente todas las notas vinculadas en MongoDB.
   */
  async updateSpace(id: string, userId: string, updateSpaceDto: UpdateSpaceDto) {
    const space = await this.spacesRepository.findByIdAndUser(id, userId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }
    const oldName = space.name;
    const newName = updateSpaceDto.name ? updateSpaceDto.name.trim() : oldName;

    const updated = await this.spacesRepository.update(id, userId, {
      ...updateSpaceDto,
      name: newName,
    });

    if (oldName !== newName) {
      await this.noteModel.updateMany(
        {
          userId: new Types.ObjectId(userId) as any,
          space: oldName,
        },
        {
          $set: { space: newName },
        },
      ).exec();
    }

    return updated;
  }

  /**
   * Elimina un espacio/directorio de la base de datos.
   */
  async deleteSpace(id: string, userId: string) {
    const deleted = await this.spacesRepository.delete(id, userId);
    if (!deleted) {
      throw new NotFoundException('Space not found');
    }
    return { success: true, message: 'Space deleted successfully' };
  }
}
