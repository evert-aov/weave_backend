import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersRepository } from '../../modules/auth/repositories/users.repository';

/**
 * Estrategia de Passport para validar tokens JWT en peticiones autenticadas.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersRepository: UsersRepository) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'weave_super_secret_jwt_key_2026',
    });
  }

  /**
   * Valida la carga útil (payload) del token JWT y recupera el usuario correspondiente.
   */
  async validate(payload: { sub: string; email: string }) {
    const user = await this.usersRepository.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or invalid token');
    }
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}
