import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateBlockDto } from './block.dto';

/**
 * DTO para la creación de un nuevo documento / nota.
 */
export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  lead?: string;

  @IsString()
  @IsOptional()
  space?: string;

  @IsString()
  @IsOptional()
  docType?: string;

  @IsString()
  @IsOptional()
  docUrl?: string;

  @IsOptional()
  docData?: any;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBlockDto)
  @IsOptional()
  blocks?: CreateBlockDto[];
}

/**
 * DTO para la actualización de un documento / nota existente.
 */
export class UpdateNoteDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  lead?: string;

  @IsString()
  @IsOptional()
  space?: string;

  @IsString()
  @IsOptional()
  docType?: string;

  @IsString()
  @IsOptional()
  docUrl?: string;

  @IsOptional()
  docData?: any;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBlockDto)
  @IsOptional()
  blocks?: CreateBlockDto[];
}
