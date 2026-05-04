import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommunityService } from './community.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateFollowRequestDto } from './dto/create-follow-request.dto';
import {
  assertAllowedImageMime,
  assertUploadPresent,
  assertUploadSize,
  normalizeMimeType,
  UPLOAD_LIMITS,
} from '../common/upload/upload-policy';
import { buildImageUploadOptions } from '../common/upload/multer-upload-options';

@ApiTags('community')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Post('upload-post-image')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', buildImageUploadOptions()))
  @ApiOperation({ summary: 'Upload image for a post' })
  @ApiResponse({ status: 201, description: 'Returns { imageUrl }' })
  @ApiResponse({ status: 400, description: 'No file or invalid type' })
  async uploadPostImage(
    // Avoid relying on Multer types — use a minimal inline shape for the uploaded file.
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname?: string },
  ) {
    assertUploadPresent(file);
    assertUploadSize(file.buffer, UPLOAD_LIMITS.imageBytes);
    const mimetype = normalizeMimeType(file.mimetype);
    assertAllowedImageMime(mimetype);
    const imageUrl = await this.communityService.uploadPostImage({
      buffer: file.buffer,
      mimetype: mimetype.startsWith('image/') ? mimetype : 'image/jpeg',
    });
    return { imageUrl };
  }

  @Post('posts')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({ status: 201, description: 'Post created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createPost(
    @Request() req: { user: { id: string } },
    @Body() dto: CreatePostDto,
  ) {
    return this.communityService.createPost(req.user.id, dto);
  }

  @Get('posts')
  @ApiOperation({
    summary: 'Get all posts (feed) or posts by author (profile)',
  })
  @ApiResponse({ status: 200, description: 'List of posts' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPosts(
    @Query('authorId') authorId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      const pageNum = Number.parseInt(page ?? '', 10);
      const limitNum = Number.parseInt(limit ?? '', 10);
      const resolvedPage =
        Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
      const resolvedLimit =
        Number.isFinite(limitNum) && limitNum > 0
          ? Math.min(100, limitNum)
          : 50;
      if (authorId && authorId.trim()) {
        return this.communityService.getPostsByAuthorPaginated(
          authorId.trim(),
          resolvedPage,
          resolvedLimit,
        );
      }
      return this.communityService.getPostsPaginated(
        resolvedPage,
        resolvedLimit,
      );
    }
    if (authorId && authorId.trim()) {
      return this.communityService.getPostsByAuthor(authorId.trim());
    }
    return this.communityService.getPosts();
  }

  @Patch('posts/:id')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @ApiOperation({ summary: 'Update a post (author only)' })
  @ApiResponse({ status: 200, description: 'Post updated' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async updatePost(
    @Request() req: { user: { id: string } },
    @Param('id') postId: string,
    @Body() dto: UpdatePostDto,
  ) {
    await this.communityService.updatePost(postId, req.user.id, dto);
    return { success: true };
  }

  @Delete('posts/:id')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Delete a post (author only)' })
  @ApiResponse({ status: 200, description: 'Post deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async deletePost(
    @Request() req: { user: { id: string } },
    @Param('id') postId: string,
  ) {
    await this.communityService.deletePost(postId, req.user.id);
    return { success: true };
  }

  @Post('posts/:id/like')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 90, ttl: 60000 } })
  @ApiOperation({ summary: 'Toggle like on a post' })
  @ApiResponse({ status: 200, description: 'Like toggled' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async toggleLike(
    @Request() req: { user: { id: string } },
    @Param('id') postId: string,
  ) {
    return this.communityService.toggleLike(postId, req.user.id);
  }

  @Get('posts/:id/comments')
  @ApiOperation({ summary: 'Get comments for a post' })
  @ApiResponse({ status: 200, description: 'List of comments' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getComments(
    @Param('id') postId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      const pageNum = Number.parseInt(page ?? '', 10);
      const limitNum = Number.parseInt(limit ?? '', 10);
      const resolvedPage =
        Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
      const resolvedLimit =
        Number.isFinite(limitNum) && limitNum > 0
          ? Math.min(100, limitNum)
          : 50;
      return this.communityService.getCommentsPaginated(
        postId,
        resolvedPage,
        resolvedLimit,
      );
    }
    return this.communityService.getComments(postId);
  }

  @Post('posts/:id/comments')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Add a comment to a post' })
  @ApiResponse({ status: 201, description: 'Comment added' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async addComment(
    @Request() req: { user: { id: string } },
    @Param('id') postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.communityService.addComment(postId, req.user.id, dto);
  }

  @Get('posts/like-status')
  @ApiOperation({ summary: 'Get like status for current user on given posts' })
  @ApiResponse({ status: 200, description: 'Map of postId -> liked' })
  async getLikeStatus(
    @Request() req: { user: { id: string } },
    @Query('postIds') postIdsParam?: string,
  ) {
    const postIds = postIdsParam ? postIdsParam.split(',').filter(Boolean) : [];
    return this.communityService.getPostLikeStatus(postIds, req.user.id);
  }

  @Post('follow-requests')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Send a follow request to a user' })
  @ApiResponse({
    status: 201,
    description: 'Request created; target gets a notification',
  })
  @ApiResponse({ status: 400, description: 'Invalid target or self-follow' })
  async createFollowRequest(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateFollowRequestDto,
  ) {
    return this.communityService.createFollowRequest(
      req.user.id,
      dto.targetUserId,
    );
  }

  @Get('follow-requests/status')
  @ApiOperation({ summary: 'Get follow status toward a user' })
  @ApiResponse({
    status: 200,
    description: '{ status: "pending" | "accepted" | "declined" | null }',
  })
  async getFollowStatus(
    @Request() req: { user: { id: string } },
    @Query('targetUserId') targetUserId: string,
  ) {
    if (!targetUserId) {
      return { status: null };
    }
    return this.communityService.getFollowStatus(req.user.id, targetUserId);
  }

  @Get('follow-requests/pending')
  @ApiOperation({
    summary: 'List pending follow requests for the current user',
  })
  @ApiResponse({ status: 200, description: 'List of pending requests' })
  async listPendingFollowRequests(@Request() req: { user: { id: string } }) {
    return this.communityService.listPendingFollowRequests(req.user.id);
  }

  @Get('members/:userId/public-info')
  @ApiOperation({
    summary: 'Get member public info for profile display',
  })
  @ApiResponse({
    status: 200,
    description:
      'Strict public DTO: { fullName, profilePic?, role?, specialty? } or null if not found',
  })
  async getMemberPublicInfo(@Param('userId') userId: string) {
    return this.communityService.getMemberPublicInfo(userId);
  }

  @Get('members/:userId/contact-info')
  @ApiOperation({
    summary: 'Get member contact info (email, phone) — only if friends',
  })
  @ApiResponse({
    status: 200,
    description: '{ fullName, email?, phone? } or null if not friends',
  })
  async getMemberContactInfo(
    @Request() req: { user: { id: string } },
    @Param('userId') userId: string,
  ) {
    return this.communityService.getMemberContactInfo(req.user.id, userId);
  }

  @Get('follow-requests/friends')
  @ApiOperation({
    summary: 'List accepted friends (mine or of another user for profile view)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of { id, fullName, profilePic }',
  })
  async listFriends(
    @Request() req: { user: { id: string } },
    @Query('userId') userId?: string,
  ) {
    const targetUserId = userId && userId.trim() ? userId.trim() : req.user.id;
    return this.communityService.listFriends(targetUserId);
  }

  @Post('follow-requests/:id/accept')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a follow request' })
  @ApiResponse({ status: 200, description: 'Accepted' })
  @ApiResponse({ status: 403, description: 'Not the target user' })
  async acceptFollowRequest(
    @Request() req: { user: { id: string } },
    @Param('id') requestId: string,
  ) {
    await this.communityService.acceptFollowRequest(requestId, req.user.id);
    return { success: true };
  }

  @Post('follow-requests/:id/decline')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a follow request' })
  @ApiResponse({ status: 200, description: 'Declined' })
  @ApiResponse({ status: 403, description: 'Not the target user' })
  async declineFollowRequest(
    @Request() req: { user: { id: string } },
    @Param('id') requestId: string,
  ) {
    await this.communityService.declineFollowRequest(requestId, req.user.id);
    return { success: true };
  }

  @Post('follow-requests/:id/cancel')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel your own follow request (requester withdraws)',
  })
  @ApiResponse({ status: 200, description: 'Cancelled' })
  @ApiResponse({ status: 403, description: 'Not the requester' })
  async cancelFollowRequest(
    @Request() req: { user: { id: string } },
    @Param('id') requestId: string,
  ) {
    await this.communityService.cancelFollowRequest(requestId, req.user.id);
    return { success: true };
  }
}
