import { BadRequestException } from '@nestjs/common';
import { AI_ATTACHMENT_MIME_TYPES, ChatRequestDto } from './chat.dto';

export const CHAT_LIMITS = {
  message: 250_000, document: 1_500_000, historyMessage: 12_000,
  historyTotal: 60_000, historyMessages: 30, title: 500, docType: 100,
  editTargetsMax: 10_000, editTargetChars: 100_000, editTargetsBudget: 1_500_000,
  attachmentPayloadChars: 32 * 1024 * 1024, attachmentTextChars: 2_400_000,
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
    throw new BadRequestException('El mensaje de IA debe tener entre 1 y 250 000 caracteres.');
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
  if (editTargets && (editTargets.length > CHAT_LIMITS.editTargetsMax || editTargets.some(item => item.text.length > CHAT_LIMITS.editTargetChars) || editTargets.reduce((n, item) => n + item.id.length + item.text.length, 0) > CHAT_LIMITS.editTargetsBudget)) {
    throw new BadRequestException('El contexto de edición supera el límite.');
  }
  const attachments=dto.attachments||[];
  const attachmentPayloadChars = attachments.reduce((n,a)=>n+(a.data?.length||a.text?.length||0),0);
  const attachmentTextChars = attachments.reduce((n,a)=>n+(a.text?.length||0),0);
  if(attachments.length>10||attachmentPayloadChars>CHAT_LIMITS.attachmentPayloadChars||attachmentTextChars>CHAT_LIMITS.attachmentTextChars)throw new BadRequestException('Los adjuntos superan el límite combinado de 32 MiB o 2,4 millones de caracteres de texto.');
  for(const a of attachments){
    if(!AI_ATTACHMENT_MIME_TYPES.includes(a.mimeType)||(a.mimeType!=='text/plain'?(!a.data||a.text!==undefined||a.data.length>5_600_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data)):(!a.text||a.data!==undefined||a.text.length>800_000)))throw new BadRequestException('Adjunto inválido.');
  }
  return {
    ...(attachments.length?{attachments}:{}),
    ...(dto.conversationId ? { conversationId: dto.conversationId } : {}),
    ...(dto.model ? { model: dto.model } : {}),
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
