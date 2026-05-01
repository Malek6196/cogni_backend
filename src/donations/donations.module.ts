import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Donation, DonationSchema } from './schemas/donation.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DonationsService } from './donations.service';
import { DonationsController } from './donations.controller';
import { LlmService } from '../progress-ai/llm.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Donation.name, schema: DonationSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [DonationsController],
  providers: [DonationsService, LlmService],
  exports: [DonationsService],
})
export class DonationsModule {}
