import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { NotesModule } from './modules/notes/notes.module';
import { AssetsModule } from './modules/assets/assets.module';
import { SpacesModule } from './modules/spaces/spaces.module';
import { LatexModule } from './modules/latex/latex.module';
import { AiModule } from './modules/ai/ai.module';

/**
 * Módulo raíz de la aplicación Weave Backend.
 * Configura la conexión a MongoDB, rate limiting global y monta los módulos de negocio.
 * Los activos públicos se sirven de forma controlada desde `UploadsFallbackController`
 * (nunca se exponen payloads privados `.json` / `.pptx` sin autenticación).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri:
          configService.get<string>('MONGODB_URI') ||
          'mongodb://127.0.0.1:27017/weave_db',
        family: 4,
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    NotesModule,
    AssetsModule,
    SpacesModule,
    AiModule,
    LatexModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
