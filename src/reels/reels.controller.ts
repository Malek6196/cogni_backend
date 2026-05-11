import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  UseGuards,
  Param,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReelsService } from './reels.service';
import { Types } from 'mongoose';

@ApiTags('reels')
@Controller('reels')
export class ReelsController {
  constructor(private readonly reelsService: ReelsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List reels (short videos) filtered for cognitive diseases / dementia / memory',
  })
  async list(@Query('page') page?: string, @Query('limit') limit?: string) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const l = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));
    return this.reelsService.list(p, l);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Refresh reels: Invidious + Dailymotion + TikTok (REELS_TIKTOK_URLS, oEmbed) + seed; daily cron also runs',
  })
  async refresh() {
    return this.reelsService.refreshFromYoutube();
  }

  @Post('purge-blocked')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Remove blocked YouTube reels from DB (e.g. embed error 153) without full refresh',
  })
  async purgeBlocked() {
    return this.reelsService.purgeBlockedReels();
  }

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Like a reel (increment likes counter)',
  })
  async likeReel(
    @Param('id') reelId: string,
    @Request() req: { user: { id: string } },
  ) {
    if (!Types.ObjectId.isValid(reelId)) {
      throw new BadRequestException('Invalid reel ID');
    }
    return this.reelsService.likeReel(reelId, req.user.id);
  }

  @Delete(':id/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Unlike a reel (decrement likes counter)',
  })
  async unlikeReel(
    @Param('id') reelId: string,
    @Request() req: { user: { id: string } },
  ) {
    if (!Types.ObjectId.isValid(reelId)) {
      throw new BadRequestException('Invalid reel ID');
    }
    return this.reelsService.unlikeReel(reelId, req.user.id);
  }

  @Post(':id/save')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Save a reel (increment saves counter)',
  })
  async saveReel(
    @Param('id') reelId: string,
    @Request() req: { user: { id: string } },
  ) {
    if (!Types.ObjectId.isValid(reelId)) {
      throw new BadRequestException('Invalid reel ID');
    }
    return this.reelsService.saveReel(reelId, req.user.id);
  }

  @Delete(':id/save')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Unsave a reel (decrement saves counter)',
  })
  async unsaveReel(
    @Param('id') reelId: string,
    @Request() req: { user: { id: string } },
  ) {
    if (!Types.ObjectId.isValid(reelId)) {
      throw new BadRequestException('Invalid reel ID');
    }
    return this.reelsService.unsaveReel(reelId, req.user.id);
  }

  @Post(':id/share')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Track a share (increment shares counter)',
  })
  async shareReel(
    @Param('id') reelId: string,
    @Request() req: { user: { id: string } },
  ) {
    if (!Types.ObjectId.isValid(reelId)) {
      throw new BadRequestException('Invalid reel ID');
    }
    return this.reelsService.trackShare(reelId, req.user.id);
  }

  @Post(':id/comment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Track a comment interaction (increment comments counter)',
  })
  async commentReel(
    @Param('id') reelId: string,
    @Request() req: { user: { id: string } },
  ) {
    if (!Types.ObjectId.isValid(reelId)) {
      throw new BadRequestException('Invalid reel ID');
    }
    return this.reelsService.trackComment(reelId, req.user.id);
  }
}
