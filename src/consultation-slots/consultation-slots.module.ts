import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ConsultationSlot,
  ConsultationSlotSchema,
} from './schemas/consultation-slot.schema';
import { ConsultationSlotsService } from './consultation-slots.service';
import { ConsultationSlotsController } from './consultation-slots.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConsultationSlot.name, schema: ConsultationSlotSchema },
    ]),
  ],
  controllers: [ConsultationSlotsController],
  providers: [ConsultationSlotsService],
  exports: [ConsultationSlotsService],
})
export class ConsultationSlotsModule {}
