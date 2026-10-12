import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Tipos de bloques admitidos en Weave.
 */
export type BlockType =
  | 'text'
  | 'canvas'
  | 'latex'
  | 'image'
  | 'sheet'
  | 'code'
  | 'mermaid';

/**
 * Entidad embebida que representa un bloque dentro de un documento.
 */
@Schema({ _id: false })
export class Block {
  @Prop({ required: true })
  id: string;

  @Prop({
    required: true,
    enum: ['text', 'canvas', 'latex', 'image', 'sheet', 'code', 'mermaid'],
  })
  type: BlockType;

  @Prop({ required: true, default: 0 })
  order: number;

  @Prop({ type: Object, default: {} })
  content: Record<string, any>;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;
}

export const BlockSchema = SchemaFactory.createForClass(Block);
