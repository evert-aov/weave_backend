import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Matches, ArrayMaxSize, ValidateNested } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @IsIn(['user', 'model', 'assistant'])
  role: 'user' | 'model' | 'assistant';

  @IsString()
  content: string;
}

export class DocumentContextDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  docType?: string;

  @IsOptional()
  @IsString()
  content?: string;
}

export class EditTargetDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  id: string;
  @IsString() @MaxLength(100_000)
  text: string;
}

export class ConversationTitleDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  title: string;
}

export const AI_ATTACHMENT_MIME_TYPES = [
  'text/plain',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
] as const;

export type AiAttachmentMimeType = (typeof AI_ATTACHMENT_MIME_TYPES)[number];

export class AiAttachmentDto {
  @IsString() @MaxLength(255) name: string;
  @IsString() @IsIn(AI_ATTACHMENT_MIME_TYPES) mimeType: AiAttachmentMimeType;
  @IsOptional() @IsString() @MaxLength(800_000) text?: string;
  @IsOptional() @IsString() @MaxLength(5_600_000) data?: string;
}

export class ChatRequestDto {
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({each:true}) @Type(()=>AiAttachmentDto)
  attachments?: AiAttachmentDto[];
  @IsOptional() @IsString() @Matches(/^(default|[a-f0-9-]{36})$/)
  conversationId?: string;

  @IsOptional() @IsString() @MaxLength(50)
  model?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10_000) @ValidateNested({ each: true }) @Type(() => EditTargetDto)
  editTargets?: EditTargetDto[];

  @IsNotEmpty()
  @IsString()
  @MaxLength(250_000)
  message: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DocumentContextDto)
  documentContext?: DocumentContextDto;

  @IsOptional()
  @IsBoolean()
  includeDocumentContext?: boolean;

  @IsOptional()
  @IsBoolean()
  persistHistory?: boolean;
}
