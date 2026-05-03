import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from './schemas/appointment.schema';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsGateway } from './gateways/appointments.gateway';
import { ConsultationSlotsModule } from '../consultation-slots/consultation-slots.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { Child, ChildSchema } from '../children/schemas/child.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Child.name, schema: ChildSchema },
    ]),
    ConsultationSlotsModule,
    NotificationsModule,
    MailModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsGateway],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
