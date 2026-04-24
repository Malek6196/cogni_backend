import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ChatbotService,
  ChatMessage,
  ChatbotChatResponse,
  ChatbotConfirmResponse,
} from './chatbot.service';
import type { AssistantMode, AssistantRefreshReason } from './chatbot.service';
import {
  IsObject,
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

class ChatMessageDto {
  @IsIn(['user', 'model'])
  role: 'user' | 'model';

  @IsString()
  content: string;
}

class ChatRequestDto {
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  surface?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsObject()
  uiContext?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;

  @IsOptional()
  @IsIn(['message', 'refresh'])
  mode?: AssistantMode;

  @IsOptional()
  @IsIn(['entry', 'manual', 'navigation'])
  refreshReason?: AssistantRefreshReason;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessage[];
}

class ConfirmChatActionDto {
  @IsString()
  confirmToken!: string;
}

@ApiTags('Chatbot')
@Controller('chatbot')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('chat')
  @ApiOperation({
    summary:
      'Send a message to the Cogni assistant and optionally receive a pending action to confirm',
  })
  @ApiResponse({
    status: 200,
    description: 'Assistant reply with optional pending action',
  })
  async chat(
    @Request()
    req: {
      user: { id: string; role: string; organizationId?: string };
    },
    @Body() dto: ChatRequestDto,
  ): Promise<ChatbotChatResponse> {
    return this.chatbotService.chat(
      {
        id: req.user.id,
        role: req.user.role,
        organizationId: req.user.organizationId,
      },
      dto.message,
      dto.history ?? [],
      {
        locale: dto.locale,
        surface: dto.surface,
        route: dto.route,
        uiContext: dto.uiContext,
        forceRefresh: dto.forceRefresh,
        mode: dto.mode,
        refreshReason: dto.refreshReason,
      },
    );
  }

  @Post('confirm')
  @ApiOperation({
    summary: 'Confirm and execute a previously proposed assistant action',
  })
  @ApiResponse({
    status: 200,
    description: 'Assistant execution result',
  })
  async confirm(
    @Request()
    req: {
      user: { id: string; role: string; organizationId?: string };
    },
    @Body() dto: ConfirmChatActionDto,
  ): Promise<ChatbotConfirmResponse> {
    return this.chatbotService.confirm(
      {
        id: req.user.id,
        role: req.user.role,
        organizationId: req.user.organizationId,
      },
      dto.confirmToken,
    );
  }
}
