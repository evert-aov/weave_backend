import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

/**
 * Función principal de arranque del servidor Weave Backend.
 */
async function bootstrap() {
  // Asegurar que el directorio uploads exista
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Permitir payloads grandes: las presentaciones .pptx se envían en base64
  // (aproximadamente 4/3 del tamaño del archivo) dentro del body JSON.
  app.useBodyParser('json', { limit: '100mb' });
  app.useBodyParser('urlencoded', { limit: '100mb', extended: true });

  // Habilitar CORS para permitir peticiones del cliente Angular
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Habilitar validación global de DTOs con transformación automática de tipos
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Weave Backend running at http://localhost:${port}`);
}

void bootstrap();
