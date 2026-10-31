import { Body, Controller, Delete, Get, Post, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AiService } from '../services/ai.service';
import { ChatRequestDto, ConversationTitleDto } from '../dto/chat.dto';

/**
 * Controlador de Inteligencia Artificial para el Agente Weave AI.
 * Expone endpoints REST para interacción conversacional con acceso al contexto del documento.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(@CurrentUser('id') userId: string, @Body() dto: ChatRequestDto) {
    return this.aiService.chat(dto, userId);
  }

  @Get('history')
  async history(@CurrentUser('id') userId: string, @Query('before') before?: string, @Query('conversationId') conversationId?: string) {
    return this.aiService.history(userId, before, conversationId);
  }

  @Delete('history')
  async clearHistory(@CurrentUser('id') userId: string, @Query('conversationId') conversationId?: string) {
    return this.aiService.clearHistory(userId, conversationId);
  }

  @Get('conversations')
  conversations(@CurrentUser('id') userId: string) { return this.aiService.conversations(userId); }

  @Post('conversations')
  createConversation(@CurrentUser('id') userId: string, @Body() dto: ConversationTitleDto) {
    return this.aiService.createConversation(userId, dto.title);
  }

  @Patch('conversations/:id')
  renameConversation(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: ConversationTitleDto) {
    return this.aiService.renameConversation(userId, id, dto.title);
  }

  @Delete('conversations/:id')
  deleteConversation(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.aiService.deleteConversation(userId, id);
  }
}
