import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Space, SpaceDocument } from '../entities/space.entity';

/**
 * Repositorio de Espacios (Directorios).
 * Abstrae y desacopla la persistencia en MongoDB de la lógica de negocio.
 */
@Injectable()
export class SpacesRepository {
  constructor(
    @InjectModel(Space.name)
    private readonly spaceModel: Model<SpaceDocument>,
  ) {}

  /**
   * Obtiene todos los espacios creados por un usuario.
   */
  async findAllByUser(userId: string): Promise<SpaceDocument[]> {
    return this.spaceModel
      .find({ userId: new Types.ObjectId(userId) as any })
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * Busca un espacio por su ID y usuario propietario.
   */
  async findByIdAndUser(id: string, userId: string): Promise<SpaceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.spaceModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId) as any,
      })
      .exec();
  }

  /**
   * Crea y persiste un nuevo espacio en la base de datos.
   */
  async create(spaceData: Partial<Space>): Promise<SpaceDocument> {
    const space = new this.spaceModel(spaceData);
    return space.save();
  }

  /**
   * Actualiza el nombre, color o icono de un espacio existente.
   */
  async update(
    id: string,
    userId: string,
    updateData: Partial<Space>,
  ): Promise<SpaceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.spaceModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(userId) as any,
        },
        { $set: updateData },
        { new: true },
      )
      .exec();
  }

  /**
   * Elimina un espacio por su ID.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await this.spaceModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId) as any,
      })
      .exec();
    return (result.deletedCount ?? 0) > 0;
  }
}
