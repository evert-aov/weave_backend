import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { AiService } from './ai.service';
import { ChatRequestDto } from '../dto/chat.dto';

describe('AiService', () => {
  let service: AiService;
  const chat = (dto: ChatRequestDto) => service.chat(dto, 'user-1');
  let configService: Partial<ConfigService>;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          AI_SERVICE_URL: 'http://ai.internal:8000/',
          AI_SERVICE_TOKEN: 'bridge-token',
          AI_SERVICE_TIMEOUT_MS: '90000',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should forward the public chat DTO to the authenticated FastAPI bridge', async () => {
    const expected = {
      reply: 'Respuesta desde FastAPI',
      model: 'gemini-2.5-flash',
      provider: 'vertex',
      timestamp: '2026-10-23T00:00:00+00:00',
    };
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => expected,
    } as Response);

    await expect(chat({ message: 'Resume el documento' })).resolves.toEqual(expected);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://ai.internal:8000/internal/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-ai-service-token': 'bridge-token' }),
      }),
    );
  });

  it('should preserve chat history and document context through the public validation pipe', async () => {
    const payload = {
      message: 'Resume el documento',
      history: [{ role: 'assistant', content: '¿Qué necesitas?' }],
      documentContext: { title: 'Informe', docType: 'doc', content: 'x'.repeat(60_000) },
      includeDocumentContext: true,
      persistHistory: false,
    };
    const dto = await new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }).transform(payload, { type: 'body', metatype: ChatRequestDto });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'OK' }),
    } as Response);

    await chat(dto);

    const request = fetchSpy.mock.calls[0][1]!;
    expect(JSON.parse(request.body as string)).toEqual({
      ...payload, documentContext: { ...payload.documentContext, content: 'x'.repeat(30_000) },
    });
  });

  it('bounds long previous replies and the total history before sending JSON to FastAPI', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ reply: 'OK' }) } as Response);
    await chat({ message: 'Continúa', persistHistory: false, history: Array.from({ length: 30 }, (_, index) => ({
      role: 'assistant', content: `${index}:` + 'x'.repeat(50_000),
    })) });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.history.reduce((sum: number, item: { content: string }) => sum + item.content.length, 0)).toBeLessThanOrEqual(24_000);
    expect(body.history.every((item: { content: string }) => item.content.length <= 12_000)).toBe(true);
    expect(body.history.at(-1).content.startsWith('29:')).toBe(true);
    expect(Buffer.byteLength(fetchSpy.mock.calls[0][1]!.body as string)).toBeLessThan(150_000);
  });

  it('rejects an oversized current prompt without calling the AI provider', async () => {
    await expect(chat({ message: 'x'.repeat(12_001) })).rejects.toThrow(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should identify invalid fields from FastAPI without leaking rejected input', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{
        loc: ['body', 'history', 0, 'role'],
        type: 'literal_error',
        input: 'CONFIDENTIAL_TEXT',
        msg: 'provider validation detail',
      }] }),
    } as Response);

    try {
      const error = await chat({ message: 'Hola' }).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain('body.history.0.role (literal_error)');
      expect((error as BadRequestException).message).not.toContain('CONFIDENTIAL_TEXT');
      expect(logSpy).toHaveBeenCalledWith(
        'AI service validation failed: body.history.0.role (literal_error)',
      );
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain('CONFIDENTIAL_TEXT');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('should normalize nullable optional fields accepted by the public API', async () => {
    const dto = await new ValidationPipe({ whitelist: true, transform: true }).transform(
      { message: 'Hola', history: null, includeDocumentContext: null },
      { type: 'body', metatype: ChatRequestDto },
    );
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ reply: 'OK' }) } as Response);

    await chat(dto);

    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      message: 'Hola', history: [], includeDocumentContext: true, persistHistory: true,
    });
  });

  it('should omit document context when the user disabled it', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ reply: 'OK' }) } as Response);
    await chat({
      message: 'Hola',
      includeDocumentContext: false,
      documentContext: { content: 'PRIVATE_DOCUMENT' },
    });

    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      message: 'Hola', history: [], includeDocumentContext: false, persistHistory: true,
    });
  });

  it('should handle a validation response without JSON as a client error', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => { throw new SyntaxError('invalid JSON'); },
    } as unknown as Response);
    try {
      await expect(chat({ message: 'Hola' })).rejects.toThrow(BadRequestException);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('uses only the authenticated identity and drops browser-supplied history for persistent chat', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ reply: 'OK' }) } as Response);
    await chat({ message: 'Hola', history: [{ role: 'assistant', content: 'FORGED_HISTORY' }] });
    const options = fetchSpy.mock.calls[0][1]!;
    expect(options.headers).toEqual(expect.objectContaining({ 'x-weave-user-id': 'user-1' }));
    expect(JSON.parse(options.body as string)).toEqual({
      message: 'Hola', history: [], includeDocumentContext: true, persistHistory: true,
    });
  });

  it('proxies history reads and deletes to FastAPI for the authenticated user', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) } as Response);
    await service.history('user-1', '123');
    expect(fetchSpy).toHaveBeenLastCalledWith('http://ai.internal:8000/internal/history?before=123',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'x-weave-user-id': 'user-1' }) }));
    await service.clearHistory('user-1');
    expect(fetchSpy).toHaveBeenLastCalledWith('http://ai.internal:8000/internal/history',
      expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ 'x-weave-user-id': 'user-1' }) }));
  });

  it('rejects invalid pagination and missing user identity before contacting FastAPI', async () => {
    await expect(service.history('user-1', '-1')).rejects.toThrow(BadRequestException);
    await expect(service.history('user-1', '1&user=other')).rejects.toThrow(BadRequestException);
    await expect(service.history('')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('scopes chat management and history using a validated conversation ID', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await service.history('user-1', '10', id);
    expect(fetchSpy).toHaveBeenLastCalledWith(`http://ai.internal:8000/internal/history?before=10&conversationId=${id}`, expect.anything());
    await service.createConversation('user-1', 'Física');
    expect(JSON.parse(fetchSpy.mock.calls.at(-1)![1]!.body as string)).toEqual({ title: 'Física' });
    await service.renameConversation('user-1', id, 'Nuevo nombre');
    expect(fetchSpy).toHaveBeenLastCalledWith(`http://ai.internal:8000/internal/conversations/${id}`, expect.objectContaining({ method: 'PATCH' }));
    expect(() => service.deleteConversation('user-1', '../history')).toThrow(BadRequestException);
  });

  it('forwards bounded edit targets and drops them when document context is disabled', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ reply: 'Listo' }) } as Response);
    const editTargets = [{ id: 'latex:source', text: 'x+x' }];
    await chat({ message: 'Simplifica', editTargets });
    expect(JSON.parse(fetchSpy.mock.calls.at(-1)![1]!.body as string).editTargets).toEqual(editTargets);
    await chat({ message: 'Hola', includeDocumentContext: false, editTargets });
    expect(JSON.parse(fetchSpy.mock.calls.at(-1)![1]!.body as string).editTargets).toBeUndefined();
    await expect(chat({ message: 'Grande', editTargets: [{ id: 'a', text: 'x'.repeat(24_001) }] })).rejects.toThrow(BadRequestException);
  });

});
