import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { BlockType } from '../entities/block.entity';

/**
 * DTO para la creación de un nuevo bloque dentro de un documento.
 */
export class CreateBlockDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsIn(['text', 'canvas', 'latex', 'image', 'sheet', 'code', 'mermaid'])
  type: BlockType;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsObject()
  @IsOptional()
  content?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO para la actualización parcial de un bloque.
 */
export class UpdateBlockDto {
  @IsNumber()
  @IsOptional()
  order?: number;

  @IsObject()
  @IsOptional()
  content?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO para reordenar la secuencia de bloques.
 */
export class ReorderBlocksDto {
  @IsNotEmpty()
  blockIds: string[];
}
