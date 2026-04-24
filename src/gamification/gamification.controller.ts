import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GamificationService } from './gamification.service';
import { RecordGameSessionDto } from './dto/record-game-session.dto';
import { SaveGameProgressDto } from './dto/save-game-progress.dto';
import { GameType } from './schemas/game-session.schema';
import { CreateGameRequestDto } from './dto/create-game-request.dto';
import {
  ConfirmChildLockResetDto,
  ResetChildLockByParentAuthDto,
  SetupChildLockDto,
  VerifyChildLockDto,
} from './dto/child-lock.dto';

@ApiTags('gamification')
@Controller('gamification')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class GamificationController {
  private readonly logger = new Logger(GamificationController.name);

  constructor(private readonly gamificationService: GamificationService) {}

  @Post('children/:childId/game-session')
  @ApiOperation({ summary: 'Record a game session and update points/badges' })
  async recordGameSession(
    @Request()
    req: { user: { id: string; role: string; organizationId?: string } },
    @Param('childId') childId: string,
    @Body() dto: RecordGameSessionDto,
  ) {
    const result = await this.gamificationService.recordGameSession(
      childId,
      dto,
      req.user,
    );
    return result;
  }

  @Get('children/:childId/stats')
  @ApiOperation({
    summary: 'Get child gamification stats (points, badges, progress)',
  })
  async getChildStats(
    @Request()
    req: { user: { id: string; role: string; organizationId?: string } },
    @Param('childId') childId: string,
  ) {
    return this.gamificationService.getChildStats(childId, req.user);
  }

  @Put('children/:childId/games/:gameType/progress')
  @ApiOperation({ summary: 'Save real-time game progress for a child/game' })
  async saveGameProgress(
    @Request()
    req: { user: { id: string; role: string; organizationId?: string } },
    @Param('childId') childId: string,
    @Param('gameType') gameType: GameType,
    @Body() dto: SaveGameProgressDto,
  ) {
    return this.gamificationService.saveGameProgress(
      childId,
      gameType,
      dto,
      req.user,
    );
  }

  @Get('children/:childId/games/:gameType/progress')
  @ApiOperation({ summary: 'Get last saved game progress for resume support' })
  async getGameProgress(
    @Request()
    req: { user: { id: string; role: string; organizationId?: string } },
    @Param('childId') childId: string,
    @Param('gameType') gameType: GameType,
  ) {
    return this.gamificationService.getGameProgress(
      childId,
      gameType,
      req.user,
    );
  }

  @Get('children/:childId/games/progress')
  @ApiOperation({ summary: 'Get saved progress for all games for one child' })
  async getAllGameProgress(
    @Request()
    req: { user: { id: string; role: string; organizationId?: string } },
    @Param('childId') childId: string,
  ) {
    return this.gamificationService.getAllGameProgress(childId, req.user);
  }

  @Get('games/catalog')
  @ApiOperation({
    summary: 'Get games catalog with enabled and coming-soon games',
  })
  getGamesCatalog() {
    return this.gamificationService.getGamesCatalog();
  }

  @Post('game-requests')
  @Roles('family')
  @ApiOperation({ summary: 'Create a game request for admin review' })
  async createGameRequest(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateGameRequestDto,
  ) {
    return this.gamificationService.createGameRequest(req.user.id, dto);
  }

  @Get('child-lock/status')
  @Roles('family')
  @ApiOperation({ summary: 'Check if child play lock is configured' })
  async childLockStatus(@Request() req: { user: { id: string } }) {
    return this.gamificationService.getChildLockStatus(req.user.id);
  }

  @Post('child-lock/setup')
  @Roles('family')
  @ApiOperation({
    summary: 'Set child play lock password for first-time setup',
  })
  async setupChildLock(
    @Request() req: { user: { id: string } },
    @Body() dto: SetupChildLockDto,
  ) {
    return this.gamificationService.setupChildLock(req.user.id, dto.password);
  }

  @Post('child-lock/verify')
  @Roles('family')
  @ApiOperation({ summary: 'Verify child play lock password' })
  async verifyChildLock(
    @Request() req: { user: { id: string } },
    @Body() dto: VerifyChildLockDto,
  ) {
    return this.gamificationService.verifyChildLock(req.user.id, dto.password);
  }

  @Post('child-lock/reset/request')
  @Roles('family')
  @ApiOperation({ summary: 'Send child play lock reset code to parent email' })
  async requestChildLockReset(@Request() req: { user: { id: string } }) {
    return this.gamificationService.requestChildLockResetByEmail(req.user.id);
  }

  @Post('child-lock/reset/confirm')
  @Roles('family')
  @ApiOperation({ summary: 'Reset child play lock by email verification code' })
  async confirmChildLockReset(
    @Request() req: { user: { id: string } },
    @Body() dto: ConfirmChildLockResetDto,
  ) {
    return this.gamificationService.confirmChildLockResetByEmail(
      req.user.id,
      dto.code,
      dto.newPassword,
    );
  }

  @Post('child-lock/reset/parent-auth')
  @Roles('family')
  @ApiOperation({
    summary: 'Reset child play lock using parent account password',
  })
  async resetChildLockByParentAuth(
    @Request() req: { user: { id: string } },
    @Body() dto: ResetChildLockByParentAuthDto,
  ) {
    return this.gamificationService.resetChildLockByParentAuth(
      req.user.id,
      dto.parentAccountPassword,
      dto.newPassword,
    );
  }
}
