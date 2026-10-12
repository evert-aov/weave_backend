import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { User, UserSchema } from './entities/user.entity';
import { UsersRepository } from './repositories/users.repository';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';

/**
 * Módulo de Autenticación de Weave.
 * Integra entidades, repositorio, servicios, controlador y estrategias de seguridad JWT.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'weave_super_secret_jwt_key_2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [UsersRepository, AuthService, JwtStrategy],
  exports: [UsersRepository, JwtModule, PassportModule],
})
export class AuthModule {}
