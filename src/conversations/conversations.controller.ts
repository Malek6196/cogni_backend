/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConversationsService } from './conversations.service';
import {
  assertAllowedImageMime,
  assertAllowedVoiceMime,
  assertUploadPresent,
  assertUploadSize,
  normalizeMimeType,
  UPLOAD_LIMITS,
} from '../common/upload/upload-policy';
import { buildImageOrVoiceUploadOptions } from '../common/upload/multer-upload-options';

@ApiTags('conversations')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  private getCurrentUserId(req: {
    user?: { id?: string; sub?: string; userId?: string };
  }): string {
    const user = req?.user;
    const userId = user?.id ?? user?.sub ?? user?.userId ?? '';
    if (!userId) {
      throw new UnauthorizedException('Utilisateur non authentifie');
    }
    return userId;
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Get inbox conversations for current user' })
  async getInbox(@Request() req: any) {
    const userId = this.getCurrentUserId(req);
    return this.conversationsService.findInboxForUser(userId);
  }

  @Get('by-participant/:otherUserId')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @ApiOperation({ summary: 'Get or create conversation with another user' })
  async getOrCreateConversation(
    @Request() req: any,
    @Param('otherUserId') otherUserId: string,
  ) {
    const userId = this.getCurrentUserId(req);
    const role = (req.user.role as string)?.toLowerCase?.();
    return this.conversationsService.getOrCreateConversation(
      userId,
      otherUserId,
      role,
    );
  }

  @Post('groups')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a group conversation (e.g. family group)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name' },
        participantIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'User IDs to add (creator is added automatically)',
        },
      },
      required: ['name', 'participantIds'],
    },
  })
  async createGroup(
    @Request() req: any,
    @Body() body: { name: string; participantIds: string[] },
  ) {
    const userId = this.getCurrentUserId(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : 'Groupe';
    const participantIds = Array.isArray(body?.participantIds)
      ? body.participantIds.filter((id) => typeof id === 'string')
      : [];
    return this.conversationsService.createGroup(userId, name, participantIds);
  }

  @Post(':id/members')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Add a member to a group conversation' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { userId: { type: 'string' } },
      required: ['userId'],
    },
  })
  async addMemberToGroup(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    const currentUserId = this.getCurrentUserId(req);
    const newParticipantId = body?.userId;
    if (!newParticipantId || typeof newParticipantId !== 'string') {
      throw new BadRequestException('userId is required');
    }
    return this.conversationsService.addMemberToGroup(
      id,
      currentUserId,
      newParticipantId,
    );
  }

  @Get(':id/settings')
  @ApiOperation({
    summary: 'Get conversation settings (autoSavePhotos, muted)',
  })
  async getSettings(@Request() req: any, @Param('id') id: string) {
    const userId = this.getCurrentUserId(req);
    return this.conversationsService.getSettings(id, userId);
  }

  @Patch(':id/settings')
  @ApiOperation({ summary: 'Update conversation settings' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        autoSavePhotos: { type: 'boolean' },
        muted: { type: 'boolean' },
      },
    },
  })
  async updateSettings(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { autoSavePhotos?: boolean; muted?: boolean },
  ) {
    const userId = this.getCurrentUserId(req);
    return this.conversationsService.updateSettings(id, userId, body);
  }

  @Get(':id/media')
  @ApiOperation({ summary: 'Get media (images, voice) in conversation' })
  async getMedia(@Request() req: any, @Param('id') id: string) {
    const userId = this.getCurrentUserId(req);
    return this.conversationsService.getMedia(id, userId);
  }

  @Get(':id/search')
  @ApiOperation({ summary: 'Search messages in conversation' })
  async searchMessages(
    @Request() req: any,
    @Param('id') id: string,
    @Query('q') q: string,
  ) {
    const userId = this.getCurrentUserId(req);
    return this.conversationsService.searchMessages(id, userId, q ?? '');
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getMessages(
    @Request() req: any,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.getCurrentUserId(req);
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (!hasExplicitPagination) {
      return this.conversationsService.getMessages(id, userId);
    }
    const pageNum = Number.parseInt(page ?? '', 10);
    const limitNum = Number.parseInt(limit ?? '', 10);
    const resolvedPage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
    const resolvedLimit =
      Number.isFinite(limitNum) && limitNum > 0 ? Math.min(100, limitNum) : 50;
    return this.conversationsService.getMessages(id, userId, {
      page: resolvedPage,
      limit: resolvedLimit,
    });
  }

  @Post('upload')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', buildImageOrVoiceUploadOptions()))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: ['image', 'voice'] },
      },
      required: ['file', 'type'],
    },
  })
  @ApiOperation({ summary: 'Upload chat attachment (image or voice)' })
  async uploadAttachment(
    @Request() req: any,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
    @Body() body: { type: string },
  ) {
    const userId = this.getCurrentUserId(req);
    const type = (body?.type ?? '').toLowerCase();
    if (type !== 'image' && type !== 'voice') {
      throw new BadRequestException('type must be image or voice');
    }
    assertUploadPresent(file);
    const mimetype = normalizeMimeType(file.mimetype);
    if (type === 'image') {
      assertUploadSize(file.buffer, UPLOAD_LIMITS.imageBytes);
      assertAllowedImageMime(mimetype);
    } else {
      assertUploadSize(file.buffer, UPLOAD_LIMITS.voiceBytes);
      assertAllowedVoiceMime(mimetype);
    }
    const url = await this.conversationsService.uploadAttachment(
      userId,
      { buffer: file.buffer, mimetype },
      type,
    );
    return { url };
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: 'Send a message in a conversation' })
  async sendMessage(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      text: string;
      attachmentUrl?: string;
      attachmentType?: 'image' | 'voice' | 'call_missed';
    },
  ) {
    const userId = this.getCurrentUserId(req);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text && !body?.attachmentUrl) {
      throw new BadRequestException('text or attachmentUrl is required');
    }
    const fallbackText =
      body?.attachmentType === 'call_missed'
        ? 'Appel manqué'
        : body?.attachmentType === 'voice'
          ? 'Message vocal'
          : 'Photo';
    return this.conversationsService.addMessage(
      id,
      userId,
      text || fallbackText,
      body.attachmentUrl,
      body.attachmentType,
    );
  }

  @Delete(':id/messages/:messageId')
  @ApiOperation({ summary: 'Delete a message (sender only)' })
  async deleteMessage(
    @Request() req: any,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    const userId = this.getCurrentUserId(req);
    await this.conversationsService.deleteMessage(id, messageId, userId);
    return { success: true };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a conversation (both sides)' })
  async deleteConversation(@Request() req: any, @Param('id') id: string) {
    const userId = this.getCurrentUserId(req);
    await this.conversationsService.deleteConversation(id, userId);
    return { success: true };
  }
}
