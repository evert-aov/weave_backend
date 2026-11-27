import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
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
  app.set('trust proxy', 1);

  // Cabeceras de seguridad HTTP (X-Content-Type-Options, HSTS, Referrer-Policy, X-Frame-Options, etc.)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  // Habilitar CORS estricto en producción y flexible solo en desarrollo
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
    : ['http://localhost:5000', 'http://127.0.0.1:5000'];

  if (isProd && !process.env.ALLOWED_ORIGINS) {
    console.warn('[Security] ALLOWED_ORIGINS no está definido en producción; restringiendo a dominios *.vercel.app y *.up.railway.app.');
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, '');
      if (allowedOrigins.includes(normalized) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      if (!isProd) {
        return callback(null, true);
      }
      if (!process.env.ALLOWED_ORIGINS && /^https:\/\/[a-z0-9-]+\.(?:vercel\.app|up\.railway\.app)$/i.test(normalized)) {
        return callback(null, true);
      }
      return callback(null, false);
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

  // Documentación OpenAPI / Swagger en /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Weave API')
    .setDescription('API REST de Weave (Notas, Documentos Word/Excel/LaTeX, Espacios, Activos e IA)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT || 5001;
  await app.listen(port, '0.0.0.0');
  const publicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`;
  console.log(`🚀 Weave Backend running at ${publicUrl} (listening on 0.0.0.0:${port})`);
  console.log(`📚 Swagger UI available at ${publicUrl}/api/docs`);
}

void bootstrap();
