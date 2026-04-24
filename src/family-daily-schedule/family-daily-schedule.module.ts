import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FamilyRoutinePreferences,
  FamilyRoutinePreferencesSchema,
} from './schemas/family-routine-preferences.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { FamilyDailyScheduleService } from './family-daily-schedule.service';
import { FamilyDailyScheduleController } from './family-daily-schedule.controller';
import { NutritionModule } from '../nutrition/nutrition.module';
import { ChildrenModule } from '../children/children.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: FamilyRoutinePreferences.name,
        schema: FamilyRoutinePreferencesSchema,
      },
      { name: User.name, schema: UserSchema },
    ]),
    NutritionModule,
    ChildrenModule,
    NotificationsModule,
  ],
  controllers: [FamilyDailyScheduleController],
  providers: [FamilyDailyScheduleService],
  exports: [FamilyDailyScheduleService],
})
export class FamilyDailyScheduleModule {}
