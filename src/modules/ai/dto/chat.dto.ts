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
  @IsString() @MaxLength(15_000)
  text: string;
}

export class ConversationTitleDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  title: string;
}

export class ChatRequestDto {
  @IsOptional() @IsString() @Matches(/^(default|[a-f0-9-]{36})$/)
  conversationId?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => EditTargetDto)
  editTargets?: EditTargetDto[];

  @IsNotEmpty()
  @IsString()
  @MaxLength(12_000)
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
