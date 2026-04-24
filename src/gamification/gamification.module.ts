import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import { Points, PointsSchema } from './schemas/points.schema';
import { Badge, BadgeSchema } from './schemas/badge.schema';
import { ChildBadge, ChildBadgeSchema } from './schemas/child-badge.schema';
import { GameSession, GameSessionSchema } from './schemas/game-session.schema';
import {
  GameProgress,
  GameProgressSchema,
} from './schemas/game-progress.schema';
import { GameRequest, GameRequestSchema } from './schemas/game-request.schema';
import { Child, ChildSchema } from '../children/schemas/child.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    MailModule,
    MongooseModule.forFeature([
      { name: Points.name, schema: PointsSchema },
      { name: Badge.name, schema: BadgeSchema },
      { name: ChildBadge.name, schema: ChildBadgeSchema },
      { name: GameSession.name, schema: GameSessionSchema },
      { name: GameProgress.name, schema: GameProgressSchema },
      { name: GameRequest.name, schema: GameRequestSchema },
      { name: Child.name, schema: ChildSchema },
      { name: User.name, schema: UserSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {
  constructor(private gamificationService: GamificationService) {}

  async onModuleInit() {
    // Initialize default badges on module startup
    await this.gamificationService.initializeDefaultBadges();
  }
}
