import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Child, ChildSchema } from '../children/schemas/child.schema';
import { ChildrenModule } from '../children/children.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Child.name, schema: ChildSchema },
    ]),
    AuthModule,
    ChildrenModule,
    NutritionModule,
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}
