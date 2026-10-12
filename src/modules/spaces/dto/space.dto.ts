import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO para la creación de un nuevo espacio/directorio.
 */
export class CreateSpaceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  icon?: string;
}

/**
 * DTO para la actualización de un espacio existente.
 */
export class UpdateSpaceDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  icon?: string;
}
