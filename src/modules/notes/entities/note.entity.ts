import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Block, BlockSchema } from './block.entity';

/**
 * Tipo que representa el documento hidratado de Mongoose para Note.
 */
export type NoteDocument = HydratedDocument<Note>;

/**
 * Entidad principal de un documento / nota en Weave.
 * Almacena el título, metadatos, espacio de trabajo y lista ordenada de bloques.
 */
@Schema({
  timestamps: true,
  collection: 'notes',
})
export class Note {
  _id?: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, default: 'Untitled note' })
  title: string;

  @Prop({ default: '' })
  lead: string;

  @Prop({ default: 'Research' })
  space: string;

  @Prop({ type: String, default: 'block' })
  docType: string;

  @Prop({ type: String, default: null })
  docUrl: string;

  @Prop({ type: Object, default: null })
  docData: any;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [BlockSchema], default: [] })
  blocks: Block[];
}

export const NoteSchema = SchemaFactory.createForClass(Note);
NoteSchema.index({ userId: 1, space: 1, updatedAt: -1 });
