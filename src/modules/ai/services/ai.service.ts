import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRequestDto } from '../dto/chat.dto';
import { normalizeChatRequest } from '../dto/chat-limits';

export interface AiChatResponse {
  edits?: Array<{ target: string; before: string; after: string }>;
  reply: string;
  model: string;
  provider: string;
  timestamp: string;
  userMessage?: StoredAiMessage;
  assistantMessage?: StoredAiMessage;
}

export interface StoredAiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  error: boolean;
}

export interface AiHistoryPage {
  messages: StoredAiMessage[];
  hasMore: boolean;
  nextBefore: number | null;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Reenvía una solicitud ya autenticada a FastAPI, propietario de prompts y credenciales cloud.
   */
  async chat(dto: ChatRequestDto, userId: string): Promise<AiChatResponse> {
    return this.request<AiChatResponse>('POST', '/internal/chat', userId, normalizeChatRequest(dto));
  }

  async history(userId: string, before?: string, conversationId?: string): Promise<AiHistoryPage> {
    if (before !== undefined && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before) < 1)) {
      throw new BadRequestException('El cursor del historial no es válido.');
    }
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (conversationId) params.set('conversationId', this.conversationId(conversationId));
    return this.request<AiHistoryPage>('GET', `/internal/history${params.size ? `?${params}` : ''}`, userId);
  }

  async clearHistory(userId: string, conversationId?: string): Promise<{ cleared: boolean }> {
    return this.request('DELETE', `/internal/history${conversationId ? `?conversationId=${this.conversationId(conversationId)}` : ''}`, userId);
  }

  conversations(userId: string) { return this.request('GET', '/internal/conversations', userId); }
  createConversation(userId: string, title: string) { return this.request('POST', '/internal/conversations', userId, { title }); }
  renameConversation(userId: string, id: string, title: string) { return this.request('PATCH', `/internal/conversations/${this.conversationId(id)}`, userId, { title }); }
  deleteConversation(userId: string, id: string) { return this.request('DELETE', `/internal/conversations/${this.conversationId(id)}`, userId); }
  private conversationId(id: string): string {
    if (!/^(default|[a-f0-9-]{36})$/.test(id)) throw new BadRequestException('Chat no válido.');
    return id;
  }

  private async request<T>(method: string, path: string, userId: string, body?: object): Promise<T> {
    if (!userId?.trim() || userId.length > 200) throw new UnauthorizedException();
    const serviceUrl = this.configService.get<string>('AI_SERVICE_URL')?.replace(/\/$/, '');
    const serviceToken = this.configService.get<string>('AI_SERVICE_TOKEN')?.trim();
    if (!serviceUrl || !serviceToken) {
      this.logger.error('AI bridge is not configured');
      throw new ServiceUnavailableException('El servicio de IA no está configurado.');
    }

    const configuredTimeout = Number(this.configService.get<string>('AI_SERVICE_TIMEOUT_MS'));
    const timeout = Number.isFinite(configuredTimeout) ? configuredTimeout : 90_000;
    try {
      const response = await fetch(`${serviceUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-ai-service-token': serviceToken,
          'x-weave-user-id': userId,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        if (response.status === 409) {
          throw new ConflictException('La conversación cambió o tiene una respuesta pendiente. Recarga el historial.');
        }
        if (response.status === 422) {
          const diagnostic = await this.validationDiagnostic(response);
          this.logger.error(`AI service validation failed: ${diagnostic}`);
          throw new BadRequestException(
            `La solicitud de IA contiene campos inválidos: ${diagnostic}`,
          );
        }
        this.logger.error(`AI service responded with HTTP ${response.status}`);
        throw new BadGatewayException('El servicio de IA no pudo completar la solicitud.');
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('AI service request failed without logging request content');
      throw new BadGatewayException(
        'No se pudo conectar con el servicio de IA. Intenta nuevamente en unos segundos.'
      );
    }
  }

  /** Extrae solo ubicación y tipo de error; nunca registra inputs o cuerpos completos. */
  private async validationDiagnostic(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (Array.isArray(payload.detail)) {
        const details = payload.detail.slice(0, 10).flatMap((item: unknown) => {
          if (!item || typeof item !== 'object') return [];
          const { loc, type } = item as { loc?: unknown; type?: unknown };
          if (
            !Array.isArray(loc) ||
            !loc.every((part) => typeof part === 'string' || typeof part === 'number') ||
            typeof type !== 'string'
          ) return [];
          return [`${loc.join('.')} (${type})`];
        });
        if (details.length) return details.join(', ');
      }
    } catch {
      // Un error sin JSON conserva un diagnóstico genérico y seguro.
    }
    return 'contrato interno no válido';
  }
}
