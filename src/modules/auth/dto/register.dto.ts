import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * DTO para la petición de registro de un nuevo usuario.
 */
export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
