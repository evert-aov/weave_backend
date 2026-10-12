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
        path: 'Research',
        parentId: null,
        color: 'indigo',
        icon: 'folder',
      });
      const defaultB = await this.spacesRepository.create({
        userId: new Types.ObjectId(userId) as any,
        name: 'Personal',
        path: 'Personal',
        parentId: null,
        color: 'teal',
        icon: 'folder',
      });
      spaces = [defaultA, defaultB];
    }
    return spaces;
  }

  /**
   * Crea un nuevo espacio/directorio o subdirectorio en MongoDB.
   */
  async createSpace(userId: string, createSpaceDto: CreateSpaceDto) {
    const trimmedName = createSpaceDto.name.trim();
    let parentObjectId: Types.ObjectId | null = null;
    let computedPath = trimmedName;

    if (createSpaceDto.parentId && Types.ObjectId.isValid(createSpaceDto.parentId)) {
      const parent = await this.spacesRepository.findByIdAndUser(createSpaceDto.parentId, userId);
      if (parent) {
        parentObjectId = parent._id;
        computedPath = `${parent.path || parent.name}/${trimmedName}`;
      }
    }

    return this.spacesRepository.create({
      userId: new Types.ObjectId(userId) as any,
      name: trimmedName,
      parentId: parentObjectId,
      path: computedPath,
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

    const updateData: any = {
      name: newName,
    };
    if (updateSpaceDto.color !== undefined) updateData.color = updateSpaceDto.color;
    if (updateSpaceDto.icon !== undefined) updateData.icon = updateSpaceDto.icon;
    if (updateSpaceDto.parentId !== undefined) {
      updateData.parentId = updateSpaceDto.parentId && Types.ObjectId.isValid(updateSpaceDto.parentId)
        ? new Types.ObjectId(updateSpaceDto.parentId)
        : null;
    }

    const updated = await this.spacesRepository.update(id, userId, updateData);

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
   * Elimina un espacio/directorio y todos sus subdirectorios de la base de datos.
   */
  async deleteSpace(id: string, userId: string) {
    const space = await this.spacesRepository.findByIdAndUser(id, userId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const allSpaces = await this.spacesRepository.findAllByUser(userId);
    const toDeleteIds: string[] = [id];

    const findDescendants = (parentId: string) => {
      const children = allSpaces.filter(
        (s) => s.parentId && s.parentId.toString() === parentId,
      );
      for (const child of children) {
        toDeleteIds.push(child._id.toString());
        findDescendants(child._id.toString());
      }
    };
    findDescendants(id);

    for (const deleteId of toDeleteIds) {
      await this.spacesRepository.delete(deleteId, userId);
    }

    return { success: true, message: 'Space and subdirectories deleted successfully' };
  }
}
