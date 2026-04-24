import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NutritionController } from './nutrition.controller';
import { RemindersController } from './reminders.controller';
import { NutritionService } from './nutrition.service';
import { RemindersService } from './reminders.service';
import {
  NutritionPlan,
  NutritionPlanSchema,
} from './schemas/nutrition-plan.schema';
import {
  TaskReminder,
  TaskReminderSchema,
} from './schemas/task-reminder.schema';

import { HealthModule } from '../health/health.module';
import { ChildrenModule } from '../children/children.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NutritionPlan.name, schema: NutritionPlanSchema },
      { name: TaskReminder.name, schema: TaskReminderSchema },
    ]),
    ChildrenModule,
    HealthModule,
  ],
  controllers: [NutritionController, RemindersController],
  providers: [NutritionService, RemindersService],
  exports: [NutritionService, RemindersService],
})
export class NutritionModule {}
