import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const oldPath = space.path || oldName;
    const newName = updateSpaceDto.name ? updateSpaceDto.name.trim() : oldName;

    const allSpaces = await this.spacesRepository.findAllByUser(userId);

    let newParentId: Types.ObjectId | null = space.parentId ? new Types.ObjectId(space.parentId.toString()) : null;
    let newPath = space.path || newName;

    if (updateSpaceDto.parentId !== undefined) {
      if (updateSpaceDto.parentId && Types.ObjectId.isValid(updateSpaceDto.parentId)) {
        const targetParentIdStr = updateSpaceDto.parentId.toString();
        if (targetParentIdStr === id) {
          throw new BadRequestException('A directory cannot be its own parent');
        }

        // Prevenir ciclos: no mover a un descendiente propio
        const descendantIds = new Set<string>();
        const findDescendants = (pid: string) => {
          for (const s of allSpaces) {
            if (s.parentId && s.parentId.toString() === pid) {
              descendantIds.add(s._id.toString());
              findDescendants(s._id.toString());
            }
          }
        };
        findDescendants(id);

        if (descendantIds.has(targetParentIdStr)) {
          throw new BadRequestException('Cannot move a directory into one of its subdirectories');
        }

        const parentSpace = allSpaces.find((s) => s._id.toString() === targetParentIdStr);
        if (parentSpace) {
          newParentId = parentSpace._id;
          newPath = `${parentSpace.path || parentSpace.name}/${newName}`;
        }
      } else {
        newParentId = null;
        newPath = newName;
      }
    } else if (oldName !== newName) {
      // Si solo cambió el nombre, recalcular el path con el mismo padre
      if (space.parentId) {
        const parentSpace = allSpaces.find((s) => s._id.toString() === space.parentId!.toString());
        if (parentSpace) {
          newPath = `${parentSpace.path || parentSpace.name}/${newName}`;
        } else {
          newPath = newName;
        }
      } else {
        newPath = newName;
      }
    }

    const updateData: any = {
      name: newName,
      path: newPath,
      parentId: newParentId,
    };
    if (updateSpaceDto.color !== undefined) updateData.color = updateSpaceDto.color;
    if (updateSpaceDto.icon !== undefined) updateData.icon = updateSpaceDto.icon;

    const updated = await this.spacesRepository.update(id, userId, updateData);

    // Actualizar recursivamente las rutas de todos los descendientes
    const updateDescendantPaths = async (parentIdStr: string, parentPath: string) => {
      for (const s of allSpaces) {
        if (s.parentId && s.parentId.toString() === parentIdStr) {
          const childNewPath = `${parentPath}/${s.name}`;
          await this.spacesRepository.update(s._id.toString(), userId, { path: childNewPath });

          if (s.path && s.path !== childNewPath) {
            await this.noteModel.updateMany(
              { userId: new Types.ObjectId(userId) as any, space: s.path },
              { $set: { space: childNewPath } },
            ).exec();
          }
          await updateDescendantPaths(s._id.toString(), childNewPath);
        }
      }
    };
    await updateDescendantPaths(id, newPath);

    // Sincronizar las notas que apuntaban al directorio anterior
    if (oldPath !== newPath) {
      await this.noteModel.updateMany(
        {
          userId: new Types.ObjectId(userId) as any,
          space: oldPath,
        },
        {
          $set: { space: newPath },
        },
      ).exec();
    }

    if (oldName !== newName) {
      await this.noteModel.updateMany(
        {
          userId: new Types.ObjectId(userId) as any,
          space: oldName,
        },
        {
          $set: { space: newPath },
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
