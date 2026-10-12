import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Tipo que representa el documento hidratado de Mongoose para Space.
 */
export type SpaceDocument = HydratedDocument<Space>;

/**
 * Entidad que modela un Espacio (directorio o carpeta de notas) en Weave.
 * Todo espacio pertenece a un usuario y se almacena en la base de datos MongoDB.
 */
@Schema({
  timestamps: true,
  collection: 'spaces',
})
export class Space {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Space', default: null })
  parentId: Types.ObjectId | null;

  @Prop({ default: '' })
  path: string;

  @Prop({ default: 0 })
  order: number;

  @Prop({ default: 'indigo' })
  color: string;

  @Prop({ default: 'folder' })
  icon: string;
}

export const SpaceSchema = SchemaFactory.createForClass(Space);
SpaceSchema.index({ userId: 1, parentId: 1, order: 1 });
SpaceSchema.index({ userId: 1, name: 1 });
