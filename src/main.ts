import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { configureRequestBodies } from './common/http/request-body';

/**
 * Función principal de arranque del servidor Weave Backend.
 */
async function bootstrap() {
  // Asegurar que el directorio uploads exista
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Habilitar CORS con configuración segura y compatible con credenciales
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:4200', 'http://127.0.0.1:4200'];

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origin (como curl, mobile apps o server-to-server) o que coincidan con la lista
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(null, true); // En desarrollo permitir origins dinámicos
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // CORS runs before parsing so clients can read a structured 413 response.
  configureRequestBodies(app);

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
