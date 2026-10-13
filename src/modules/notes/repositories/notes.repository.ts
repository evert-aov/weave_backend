import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from '../entities/note.entity';
import { Block } from '../entities/block.entity';

/**
 * Repositorio de Notas.
 * Abstrae y encapsula todas las operaciones de persistencia de documentos y bloques en MongoDB.
 */
@Injectable()
export class NotesRepository {
  constructor(
    @InjectModel(Note.name)
    private readonly noteModel: Model<NoteDocument>,
  ) {}

  /**
   * Obtiene todas las notas asociadas a un usuario, ordenadas por última actualización.
   */
  async findAllByUser(userId: string, space?: string): Promise<NoteDocument[]> {
    const filter: Record<string, any> = {
      userId: new Types.ObjectId(userId) as any,
    };
    if (space && space !== 'all') {
      const escaped = space.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { space: space },
        { space: new RegExp(`^${escaped}(/.*)?$`, 'i') },
      ];
    }
    return this.noteModel.find(filter).sort({ updatedAt: -1 }).exec();
  }

  /**
   * Busca una nota por su identificador y el id del usuario propietario.
   */
  async findByIdAndUser(id: string, userId: string): Promise<NoteDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.noteModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId) as any,
      })
      .exec();
  }

  /**
   * Crea y persiste un nuevo documento de nota.
   */
  async create(noteData: Partial<Note>): Promise<NoteDocument> {
    const note = new this.noteModel(noteData);
    return note.save();
  }

  /**
   * Actualiza los campos de un documento.
   */
  async update(id: string, userId: string, updateData: Partial<Note>): Promise<NoteDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.noteModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(userId) as any,
        },
        { $set: updateData },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * Elimina un documento de nota.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await this.noteModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId) as any,
      })
      .exec();
    return (result.deletedCount ?? 0) > 0;
  }

  /**
   * Añade un bloque a un documento.
   */
  async addBlock(id: string, userId: string, block: Block): Promise<NoteDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.noteModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(userId) as any,
        },
        { $push: { blocks: block } } as any,
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * Elimina un bloque específico dentro de un documento.
   */
  async removeBlock(id: string, userId: string, blockId: string): Promise<NoteDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.noteModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(userId) as any,
        },
        { $pull: { blocks: { id: blockId } } } as any,
        { returnDocument: 'after' },
      )
      .exec();
  }
}
