import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, RequestHandler } from 'express';
import { AI_BODY_LIMIT, configureRequestBodies, payloadTooLargeHandler } from './request-body';

describe('AI request transport limits', () => {
  function setup() {
    const use = jest.fn();
    const useBodyParser = jest.fn();
    configureRequestBodies({ use, useBodyParser } as unknown as NestExpressApplication);
    return { use, useBodyParser, parser: use.mock.calls[0][1] as RequestHandler };
  }

  function parse(parser: RequestHandler, body: string, declaredLength = Buffer.byteLength(body)) {
    const request = Object.assign(Readable.from([Buffer.from(body)]), {
      headers: { 'content-type': 'application/json', 'content-length': String(declaredLength) },
      method: 'POST', url: '/api/ai/chat', httpVersion: '1.1',
    }) as unknown as Request;
    return new Promise<{ error?: { type: string; status: number }; body?: unknown }>((resolve) => {
      parser(request, {} as Response, (error) => resolve({ error, body: request.body }));
    });
  }

  it('registers the AI-specific limit separately from the existing document parser', () => {
    const { use, useBodyParser } = setup();
    expect(use.mock.calls[0][0]).toBe('/api/ai');
    expect(useBodyParser).toHaveBeenCalledWith('json', { limit: '100mb' });
    expect(use.mock.calls.at(-1)![0]).toBe(payloadTooLargeHandler);
  });

  it('parses a normal chat body and rejects the reported 232 MB request without allocating it', async () => {
    const { parser } = setup();
    const body = JSON.stringify({ message: 'Hola', documentContext: { content: 'x'.repeat(15_000) } });
    const accepted = await parse(parser, body);
    expect(accepted.error).toBeUndefined();
    expect(accepted.body).toEqual(JSON.parse(body));
    const rejected = await parse(parser, '{}', 231_818_450);
    expect(rejected.error?.type).toBe('entity.too.large');
    expect(rejected.error?.status).toBe(413);
  });

  it('returns a readable 413 without logging context, the original error or query credentials', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const next = jest.fn();
    try {
      payloadTooLargeHandler({ type: 'entity.too.large', limit: AI_BODY_LIMIT, length: 231_818_450, body: 'PRIVATE_CONTENT' },
        { method: 'POST', originalUrl: '/api/ai/chat?key=PRIVATE_KEY' } as Request,
        { status } as unknown as Response, next);
      expect(status).toHaveBeenCalledWith(413);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_');
      expect(next).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
