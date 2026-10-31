import { BadRequestException } from '@nestjs/common';
import { ChatRequestDto } from './chat.dto';

export const CHAT_LIMITS = {
  message: 12_000, document: 30_000, historyMessage: 12_000,
  historyTotal: 24_000, historyMessages: 20, title: 500, docType: 100,
} as const;

function excerpt(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const bounded = value.slice(0, limit)
    .replace(/data:[^,\s"'<>]*;base64,[a-z0-9+/=_-]*/gi, '[contenido binario omitido]')
    .slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

/** The gateway bounds the request before allocating the JSON sent to FastAPI. */
export function normalizeChatRequest(dto: ChatRequestDto): ChatRequestDto {
  if (typeof dto.message !== 'string' || !dto.message.trim() || dto.message.length > CHAT_LIMITS.message) {
    throw new BadRequestException('El mensaje de IA debe tener entre 1 y 12 000 caracteres.');
  }
  const history: NonNullable<ChatRequestDto['history']> = [];
  const persistHistory = dto.persistHistory ?? true;
  let remaining: number = CHAT_LIMITS.historyTotal;
  for (const turn of (persistHistory ? [] : dto.history ?? []).slice(-CHAT_LIMITS.historyMessages).reverse()) {
    const content = excerpt(turn.content, Math.min(remaining, CHAT_LIMITS.historyMessage));
    if (content?.trim()) history.unshift({ role: turn.role, content });
    remaining -= content?.length ?? 0;
    if (remaining <= 0) break;
  }
  const includeDocumentContext = dto.includeDocumentContext ?? true;
  const context = includeDocumentContext ? dto.documentContext : undefined;
  const editTargets = includeDocumentContext ? dto.editTargets : undefined;
  if (editTargets && (editTargets.length > 200 || editTargets.reduce((n, item) => n + item.id.length + item.text.length, 0) > 24_000)) {
    throw new BadRequestException('El contexto de edición supera el límite.');
  }
  return {
    ...(dto.conversationId ? { conversationId: dto.conversationId } : {}),
    ...(editTargets?.length ? { editTargets } : {}),
    message: dto.message,
    history,
    includeDocumentContext,
    persistHistory,
    ...(context ? { documentContext: {
      title: excerpt(context.title, CHAT_LIMITS.title),
      docType: excerpt(context.docType, CHAT_LIMITS.docType),
      content: excerpt(context.content, CHAT_LIMITS.document),
    } } : {}),
  };
}
