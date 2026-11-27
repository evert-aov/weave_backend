import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { User, UserSchema } from './entities/user.entity';
import { UsersRepository } from './repositories/users.repository';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret && secret.length >= 24) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET debe estar configurado con al menos 24 caracteres en producción');
  }
  return secret || 'weave_dev_only_jwt_secret_key_2026';
}

/**
 * Módulo de Autenticación de Weave.
 * Integra entidades, repositorio, servicios, controlador y estrategias de seguridad JWT.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [UsersRepository, AuthService, JwtStrategy],
  exports: [UsersRepository, JwtModule, PassportModule],
})
export class AuthModule {}
