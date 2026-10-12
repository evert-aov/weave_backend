import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard de autenticación JWT.
 * Protege los endpoints que requieren que el usuario haya iniciado sesión.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
