import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import type { ErrorRequestHandler } from 'express';

export const AI_BODY_LIMIT = 1024 * 1024;
const logger = new Logger('RequestBody');

/** Distinguish HTTP transport limits from provider context limits without logging user content. */
export const payloadTooLargeHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error?.type !== 'entity.too.large') { next(error); return; }
  const path = request.originalUrl.split('?')[0];
  const aiRequest = /^\/api\/ai(?:\/|$)/.test(path);
  logger.warn(`Payload rejected: ${request.method} ${path}; bytes=${error.length}; limit=${error.limit}`);
  response.status(413).json({
    statusCode: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: aiRequest
      ? 'La solicitud de IA supera 1 MB. Reduce el texto o desactiva el contexto del documento e inténtalo de nuevo.'
      : 'La solicitud supera el tamaño máximo permitido. Reduce el tamaño del documento o archivo.',
  });
};

/** Register the AI parser first; document storage keeps its separate existing allowance. */
export function configureRequestBodies(app: NestExpressApplication): void {
  app.use('/api/ai', json({ limit: AI_BODY_LIMIT }));
  app.use('/api/latex', json({ limit: '2mb' }));
  app.useBodyParser('json', { limit: '100mb' });
  app.useBodyParser('urlencoded', { limit: '100mb', extended: true });
  app.use(payloadTooLargeHandler);
}
