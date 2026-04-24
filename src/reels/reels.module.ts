import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Reel, ReelSchema } from './reel.schema';
import { ReelEngagement, ReelEngagementSchema } from './reel-engagement.schema';
import { ReelsService } from './reels.service';
import { ReelsController } from './reels.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reel.name, schema: ReelSchema },
      { name: ReelEngagement.name, schema: ReelEngagementSchema },
    ]),
  ],
  controllers: [ReelsController],
  providers: [ReelsService],
  exports: [ReelsService],
})
export class ReelsModule {}
