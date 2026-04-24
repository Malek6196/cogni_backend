import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { Points, PointsDocument } from './schemas/points.schema';
import { Badge, BadgeDocument, BadgeType } from './schemas/badge.schema';
import { ChildBadge, ChildBadgeDocument } from './schemas/child-badge.schema';
import {
  GameSession,
  GameSessionDocument,
  GameType,
} from './schemas/game-session.schema';
import { Child, ChildDocument } from '../children/schemas/child.schema';
import { RecordGameSessionDto } from './dto/record-game-session.dto';
import {
  GameProgress,
  GameProgressDocument,
} from './schemas/game-progress.schema';
import {
  GameRequest,
  GameRequestDocument,
  GameRequestStatus,
} from './schemas/game-request.schema';
import { SaveGameProgressDto } from './dto/save-game-progress.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationDocument,
} from '../notifications/schemas/notification.schema';
import { CreateGameRequestDto } from './dto/create-game-request.dto';
import { MailService } from '../mail/mail.service';

export interface BadgeEarned {
  badgeId: string;
  name: string;
  description?: string;
  iconUrl?: string;
  earnedAt: Date;
}

interface RequestUserContext {
  id: string;
  role: string;
  organizationId?: string;
}

export interface GameCatalogItem {
  gameType: GameType;
  title: string;
  enabled: boolean;
  comingSoon: boolean;
}

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  private readonly gameCatalog: GameCatalogItem[] = [
    {
      gameType: GameType.MATCHING,
      title: 'Match Pairs',
      enabled: true,
      comingSoon: false,
    },
    {
      gameType: GameType.SHAPE_SORTING,
      title: 'Shape Sorting',
      enabled: true,
      comingSoon: false,
    },
    {
      gameType: GameType.STAR_TRACER,
      title: 'Star Tracer',
      enabled: true,
      comingSoon: false,
    },
    {
      gameType: GameType.BASKET_SORT,
      title: 'Basket Sort',
      enabled: true,
      comingSoon: false,
    },
  ];

  private readonly comingSoonGames: Array<{
    key: string;
    title: string;
    enabled: boolean;
    comingSoon: boolean;
  }> = [
    {
      key: 'emotion_story',
      title: 'Emotion Story',
      enabled: false,
      comingSoon: true,
    },
    {
      key: 'sound_match',
      title: 'Sound Match',
      enabled: false,
      comingSoon: true,
    },
  ];

  constructor(
    @InjectModel(Points.name) private pointsModel: Model<PointsDocument>,
    @InjectModel(Badge.name) private badgeModel: Model<BadgeDocument>,
    @InjectModel(ChildBadge.name)
    private childBadgeModel: Model<ChildBadgeDocument>,
    @InjectModel(GameSession.name)
    private gameSessionModel: Model<GameSessionDocument>,
    @InjectModel(GameProgress.name)
    private gameProgressModel: Model<GameProgressDocument>,
    @InjectModel(GameRequest.name)
    private gameRequestModel: Model<GameRequestDocument>,
    @InjectModel(Child.name) private childModel: Model<ChildDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    private readonly mailService: MailService,
  ) {}

  private async assertChildAccess(
    childId: string,
    user: RequestUserContext,
  ): Promise<ChildDocument> {
    const child = await this.childModel.findById(childId).exec();
    if (!child) throw new NotFoundException('Child not found');

    if (user.role === 'admin') return child;

    const isFamily =
      child.parentId?.toString() === user.id && user.role === 'family';
    if (isFamily) return child;

    const isAssignedSpecialist = child.specialistId?.toString() === user.id;
    if (isAssignedSpecialist) return child;

    const childOrgId = child.organizationId?.toString();
    const sameOrganization =
      !!childOrgId &&
      !!user.organizationId &&
      childOrgId === user.organizationId;
    if (sameOrganization) return child;

    throw new ForbiddenException('Not authorized to access this child data');
  }

  private validateGameType(gameType: string): GameType {
    if (!Object.values(GameType).includes(gameType as GameType)) {
      throw new BadRequestException('Unsupported game type');
    }
    return gameType as GameType;
  }

  /**
   * Record a game session and update points/badges.
   * Returns points earned, total points, and any badges unlocked.
   */
  async recordGameSession(
    childId: string,
    dto: RecordGameSessionDto,
    user: RequestUserContext,
  ): Promise<{
    pointsEarned: number;
    totalPoints: number;
    badgesEarned: BadgeEarned[];
    currentStreak: number;
  }> {
    await this.assertChildAccess(childId, user);

    const cid = new Types.ObjectId(childId);
    const pointsEarned = this.calculatePoints(dto);
    const now = new Date();

    // Get or create points document
    let points = await this.pointsModel.findOne({ childId: cid }).exec();
    if (!points) {
      points = await this.pointsModel.create({
        childId: cid,
        totalPoints: 0,
        pointsByGame: new Map(),
        gamesPlayed: [],
        gamesCompleted: 0,
        currentStreak: 0,
      });
    }

    // Update points
    const gameTypeKey = dto.gameType;
    const currentGamePoints = points.pointsByGame.get(gameTypeKey) || 0;
    points.pointsByGame.set(gameTypeKey, currentGamePoints + pointsEarned);
    points.totalPoints += pointsEarned;

    // Update games played/completed
    if (!points.gamesPlayed.includes(gameTypeKey)) {
      points.gamesPlayed.push(gameTypeKey);
    }
    if (dto.completed) {
      points.gamesCompleted += 1;
    }

    // Update streak
    const lastPlayed = points.lastPlayedDate
      ? new Date(points.lastPlayedDate)
      : null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastPlayedDate = lastPlayed
      ? new Date(
          lastPlayed.getFullYear(),
          lastPlayed.getMonth(),
          lastPlayed.getDate(),
        )
      : null;

    if (
      !lastPlayedDate ||
      lastPlayedDate.getTime() < today.getTime() - 86400000
    ) {
      // Reset streak if more than 1 day gap
      points.currentStreak = 1;
    } else if (lastPlayedDate.getTime() === today.getTime() - 86400000) {
      // Continue streak if played yesterday
      points.currentStreak += 1;
    } else if (lastPlayedDate.getTime() < today.getTime()) {
      // Same day, keep streak
      // streak stays the same
    }

    points.lastPlayedDate = now;
    await points.save();

    // Save game session
    await this.gameSessionModel.create({
      childId: cid,
      gameType: dto.gameType,
      level: dto.level,
      completed: dto.completed,
      score: pointsEarned,
      timeSpentSeconds: dto.timeSpentSeconds || 0,
      metrics: dto.metrics ? new Map(Object.entries(dto.metrics)) : new Map(),
    });

    await this.gameProgressModel
      .findOneAndUpdate(
        { childId: cid, gameType: dto.gameType },
        {
          $set: {
            completed: !!dto.completed,
            progressPercent: dto.completed ? 100 : 0,
            lastPlayedAt: now,
            state: dto.metrics ?? {},
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    // Check and award badges
    const badgesEarned = await this.checkAndAwardBadges(cid, points);

    return {
      pointsEarned,
      totalPoints: points.totalPoints,
      badgesEarned,
      currentStreak: points.currentStreak,
    };
  }

  /**
   * Calculate points for a game session based on completion and performance.
   */
  private calculatePoints(dto: RecordGameSessionDto): number {
    if (!dto.completed) return 0;
    if (dto.gameType === GameType.CHILD_MODE) return 0;

    const basePoints: Record<GameType, number> = {
      [GameType.MATCHING]: 50,
      [GameType.SHAPE_SORTING]: 50,
      [GameType.STAR_TRACER]: 75,
      [GameType.BASKET_SORT]: 50,
      [GameType.CHILD_MODE]: 0,
    };

    let points = basePoints[dto.gameType] ?? 50;

    // Bonus for speed (if timeSpentSeconds provided)
    if (dto.timeSpentSeconds && dto.timeSpentSeconds > 0) {
      const speedBonus = Math.max(0, 30 - dto.timeSpentSeconds / 10);
      points += Math.floor(speedBonus);
    }

    // Bonus for level (if applicable)
    if (dto.level && dto.level > 1) {
      points += dto.level * 5;
    }

    return Math.max(0, points);
  }

  /**
   * Check if child qualifies for any badges and award them.
   */
  private async checkAndAwardBadges(
    childId: Types.ObjectId,
    points: PointsDocument,
  ): Promise<BadgeEarned[]> {
    const badges = await this.badgeModel.find({ isActive: true }).lean().exec();
    const earnedBadges: BadgeEarned[] = [];

    for (const badge of badges) {
      // Check if already earned
      const alreadyEarned = await this.childBadgeModel
        .findOne({
          childId,
          badgeIdString: badge.badgeId,
        })
        .exec();
      if (alreadyEarned) continue;

      // Check requirements (badge from lean() may be plain object, not Map)
      let qualifies = true;
      const requirements = badge.requirements ?? {};
      const requirementEntries =
        requirements instanceof Map
          ? Array.from(requirements.entries())
          : Object.entries(requirements);
      for (const [key, requiredValue] of requirementEntries) {
        let actualValue = 0;
        switch (key) {
          case 'gamesCompleted':
            actualValue = points.gamesCompleted;
            break;
          case 'totalPoints':
            actualValue = points.totalPoints;
            break;
          case 'currentStreak':
            actualValue = points.currentStreak;
            break;
          case 'gamesPlayed':
            actualValue = points.gamesPlayed.length;
            break;
          default: {
            // Check pointsByGame
            const gamePoints = points.pointsByGame.get(key as string);
            if (gamePoints !== undefined) {
              actualValue = gamePoints;
            }
          }
        }

        if (actualValue < requiredValue) {
          qualifies = false;
          break;
        }
      }

      if (qualifies) {
        // Award badge
        await this.childBadgeModel.create({
          childId,
          badgeId: badge._id,
          badgeIdString: badge.badgeId,
          earnedAt: new Date(),
        });

        earnedBadges.push({
          badgeId: badge.badgeId,
          name: badge.name,
          description: badge.description,
          iconUrl: badge.iconUrl,
          earnedAt: new Date(),
        });

        this.logger.log(
          `Badge awarded: ${badge.badgeId} to child ${childId.toString()}`,
        );
      }
    }

    return earnedBadges;
  }

  /**
   * Get child's gamification stats (points, badges, progress).
   */
  async getChildStats(childId: string, user: RequestUserContext) {
    const cid = new Types.ObjectId(childId);
    await this.assertChildAccess(childId, user);

    const points = await this.pointsModel
      .findOne({ childId: cid })
      .lean()
      .exec();
    const badges = await this.childBadgeModel
      .find({ childId: cid })
      .populate('badgeId')
      .sort({ earnedAt: -1 })
      .lean()
      .exec();

    const recentSessions = await this.gameSessionModel
      .find({ childId: cid })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .exec();

    const rawPointsByGame = points?.pointsByGame;
    const pointsByGameMap =
      rawPointsByGame == null
        ? {}
        : rawPointsByGame instanceof Map
          ? Object.fromEntries(Array.from(rawPointsByGame.entries()))
          : rawPointsByGame;

    return {
      totalPoints: points?.totalPoints || 0,
      pointsByGame: pointsByGameMap,
      gamesCompleted: points?.gamesCompleted || 0,
      gamesPlayed: points?.gamesPlayed || [],
      currentStreak: points?.currentStreak || 0,
      badges: badges.map((b) => ({
        badgeId: b.badgeIdString,
        name: (b.badgeId as any)?.name,
        description: (b.badgeId as any)?.description,
        iconUrl: (b.badgeId as any)?.iconUrl,
        earnedAt: b.earnedAt,
      })),
      recentSessions: recentSessions.map((s) => ({
        gameType: s.gameType,
        level: s.level,
        completed: s.completed,
        score: s.score,
        timeSpentSeconds: s.timeSpentSeconds,
        metrics:
          s.metrics instanceof Map
            ? Object.fromEntries(Array.from(s.metrics.entries()))
            : (s.metrics ?? {}),
        createdAt: s.createdAt,
      })),
    };
  }

  async saveGameProgress(
    childId: string,
    gameTypeRaw: string,
    dto: SaveGameProgressDto,
    user: RequestUserContext,
  ) {
    await this.assertChildAccess(childId, user);
    const gameType = this.validateGameType(gameTypeRaw);
    const cid = new Types.ObjectId(childId);
    const now = new Date();

    const progress = await this.gameProgressModel
      .findOneAndUpdate(
        { childId: cid, gameType },
        {
          $set: {
            state: dto.state ?? {},
            progressPercent: dto.progressPercent ?? 0,
            completed: dto.completed ?? false,
            lastPlayedAt: now,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    return {
      childId,
      gameType,
      progressPercent: progress?.progressPercent ?? 0,
      completed: progress?.completed ?? false,
      state: progress?.state ?? {},
      lastPlayedAt: progress?.lastPlayedAt ?? now,
    };
  }

  async getGameProgress(
    childId: string,
    gameTypeRaw: string,
    user: RequestUserContext,
  ) {
    await this.assertChildAccess(childId, user);
    const gameType = this.validateGameType(gameTypeRaw);
    const cid = new Types.ObjectId(childId);

    const progress = await this.gameProgressModel
      .findOne({ childId: cid, gameType })
      .lean()
      .exec();

    return {
      childId,
      gameType,
      progressPercent: progress?.progressPercent ?? 0,
      completed: progress?.completed ?? false,
      state: progress?.state ?? {},
      lastPlayedAt: progress?.lastPlayedAt,
    };
  }

  async getAllGameProgress(childId: string, user: RequestUserContext) {
    await this.assertChildAccess(childId, user);
    const cid = new Types.ObjectId(childId);
    const progressList = await this.gameProgressModel
      .find({ childId: cid })
      .lean()
      .exec();

    const progressByGame = new Map(
      progressList.map((item) => [item.gameType, item]),
    );

    return {
      childId,
      games: this.gameCatalog.map((game) => {
        const p = progressByGame.get(game.gameType);
        return {
          gameType: game.gameType,
          title: game.title,
          enabled: game.enabled,
          comingSoon: false,
          progressPercent: p?.progressPercent ?? 0,
          completed: p?.completed ?? false,
          state: p?.state ?? {},
          lastPlayedAt: p?.lastPlayedAt,
        };
      }),
    };
  }

  getGamesCatalog() {
    return {
      availableGames: this.gameCatalog,
      comingSoonGames: this.comingSoonGames,
    };
  }

  async createGameRequest(familyUserId: string, dto: CreateGameRequestDto) {
    const user = await this.userModel.findById(familyUserId).lean().exec();
    if (!user || user.role !== 'family') {
      throw new ForbiddenException(
        'Only family accounts can request new games',
      );
    }

    const child = await this.childModel.findById(dto.childId).lean().exec();
    if (!child) throw new NotFoundException('Child not found');
    if (child.parentId?.toString() !== familyUserId) {
      throw new ForbiddenException(
        'You can only submit requests for your child',
      );
    }

    const request = await this.gameRequestModel.create({
      familyUserId: new Types.ObjectId(familyUserId),
      childId: new Types.ObjectId(dto.childId),
      gameName: dto.gameName.trim(),
      description: dto.description.trim(),
      childNeeds: dto.childNeeds.trim(),
      status: GameRequestStatus.PENDING,
    });

    const admins = await this.userModel
      .find({ role: 'admin' })
      .select('_id')
      .lean()
      .exec();

    if (admins.length > 0) {
      const docs = admins.map((admin) => ({
        userId: admin._id,
        type: 'game_request',
        title: 'New game request submitted',
        description: `${dto.gameName} requested for child ${dto.childId}`,
        read: false,
        data: {
          requestId: request._id.toString(),
          familyUserId,
          childId: dto.childId,
          gameName: dto.gameName,
        },
      }));
      await this.notificationModel.insertMany(docs);
    }

    return {
      id: request._id.toString(),
      status: request.status,
      createdAt: new Date(),
    };
  }

  async getChildLockStatus(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('role childPlayLockPasswordHash')
      .lean()
      .exec();
    if (!user || user.role !== 'family') {
      throw new ForbiddenException('Only family accounts can use child lock');
    }
    return { configured: !!user.childPlayLockPasswordHash };
  }

  async setupChildLock(userId: string, password: string) {
    const trimmed = password.trim();
    if (trimmed.length < 4) {
      throw new BadRequestException(
        'Password must contain at least 4 characters',
      );
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user || user.role !== 'family') {
      throw new ForbiddenException('Only family accounts can use child lock');
    }
    if (user.childPlayLockPasswordHash) {
      throw new ConflictException('Child lock is already configured');
    }

    user.childPlayLockPasswordHash = await bcrypt.hash(trimmed, 12);
    await user.save();
    return { configured: true };
  }

  async verifyChildLock(userId: string, password: string) {
    const user = await this.userModel
      .findById(userId)
      .select('role childPlayLockPasswordHash')
      .exec();
    if (!user || user.role !== 'family') {
      throw new ForbiddenException('Only family accounts can use child lock');
    }

    const hash = user.childPlayLockPasswordHash;
    if (!hash) return { valid: false, configured: false };

    const valid = await bcrypt.compare(password, hash);
    return { valid, configured: true };
  }

  async requestChildLockResetByEmail(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user || user.role !== 'family') {
      throw new ForbiddenException('Only family accounts can use child lock');
    }
    if (!user.childPlayLockPasswordHash) {
      throw new BadRequestException('Child lock is not configured');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.childPlayLockPasswordResetCode = hashedCode;
    user.childPlayLockPasswordResetExpires = expiresAt;
    await user.save();

    await this.mailService.sendPasswordResetCode(user.email, code);
    return { message: 'Reset code sent to your email' };
  }

  async confirmChildLockResetByEmail(
    userId: string,
    code: string,
    newPassword: string,
  ) {
    const trimmed = newPassword.trim();
    if (trimmed.length < 4) {
      throw new BadRequestException(
        'Password must contain at least 4 characters',
      );
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user || user.role !== 'family') {
      throw new ForbiddenException('Only family accounts can use child lock');
    }

    if (
      !user.childPlayLockPasswordResetCode ||
      !user.childPlayLockPasswordResetExpires
    ) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }
    if (new Date() > user.childPlayLockPasswordResetExpires) {
      user.childPlayLockPasswordResetCode = undefined;
      user.childPlayLockPasswordResetExpires = undefined;
      await user.save();
      throw new UnauthorizedException('Verification code has expired');
    }

    const validCode = await bcrypt.compare(
      code,
      user.childPlayLockPasswordResetCode,
    );
    if (!validCode) {
      throw new UnauthorizedException('Invalid verification code');
    }

    user.childPlayLockPasswordHash = await bcrypt.hash(trimmed, 12);
    user.childPlayLockPasswordResetCode = undefined;
    user.childPlayLockPasswordResetExpires = undefined;
    await user.save();

    return { reset: true };
  }

  async resetChildLockByParentAuth(
    userId: string,
    parentAccountPassword: string,
    newPassword: string,
  ) {
    const trimmed = newPassword.trim();
    if (trimmed.length < 4) {
      throw new BadRequestException(
        'Password must contain at least 4 characters',
      );
    }

    const user = await this.userModel
      .findById(userId)
      .select('role passwordHash childPlayLockPasswordHash')
      .exec();
    if (!user || user.role !== 'family') {
      throw new ForbiddenException('Only family accounts can use child lock');
    }

    const validParentPassword = await bcrypt.compare(
      parentAccountPassword,
      user.passwordHash,
    );
    if (!validParentPassword) {
      throw new UnauthorizedException('Parent account password is incorrect');
    }

    user.childPlayLockPasswordHash = await bcrypt.hash(trimmed, 12);
    user.childPlayLockPasswordResetCode = undefined;
    user.childPlayLockPasswordResetExpires = undefined;
    await user.save();

    return { reset: true };
  }

  /**
   * Initialize default badges (call this on module init or via migration).
   */
  async initializeDefaultBadges() {
    const defaultBadges = [
      {
        badgeId: 'first_game',
        name: 'Premier Jeu',
        description: 'Complété votre premier jeu !',
        type: BadgeType.GAMES_COMPLETED,
        requirements: { gamesCompleted: 1 },
      },
      {
        badgeId: 'points_100',
        name: '100 Points',
        description: 'Atteint 100 points !',
        type: BadgeType.POINTS_MILESTONE,
        requirements: { totalPoints: 100 },
      },
      {
        badgeId: 'points_500',
        name: '500 Points',
        description: 'Atteint 500 points !',
        type: BadgeType.POINTS_MILESTONE,
        requirements: { totalPoints: 500 },
      },
      {
        badgeId: 'streak_7',
        name: 'Série de 7 Jours',
        description: 'Joué 7 jours consécutifs !',
        type: BadgeType.STREAK,
        requirements: { currentStreak: 7 },
      },
      {
        badgeId: 'matching_master',
        name: 'Maître de la Mémoire',
        description: '100 points dans Match Pairs',
        type: BadgeType.GAME_SPECIFIC,
        requirements: { matching: 100 },
      },
      {
        badgeId: 'star_tracer_pro',
        name: 'Pro du Tracé',
        description: '200 points dans Star Tracer',
        type: BadgeType.GAME_SPECIFIC,
        requirements: { star_tracer: 200 },
      },
    ];

    for (const badgeData of defaultBadges) {
      const existing = await this.badgeModel
        .findOne({ badgeId: badgeData.badgeId })
        .exec();
      if (!existing) {
        await this.badgeModel.create({
          ...badgeData,
          requirements: new Map(Object.entries(badgeData.requirements)),
        });
        this.logger.log(`Created default badge: ${badgeData.badgeId}`);
      }
    }
  }
}
