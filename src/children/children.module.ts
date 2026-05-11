import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Child, ChildSchema } from './schemas/child.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organization/schemas/organization.schema';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import { ChildrenService } from './children.service';
import { ChildrenController } from './children.controller';
import { ChildAccessService } from './child-access.service';

import { OrganizationModule } from '../organization/organization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Child.name, schema: ChildSchema },
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
    OrganizationModule,
  ],
  controllers: [ChildrenController],
  providers: [ChildrenService, ChildAccessService],
  exports: [ChildrenService, ChildAccessService],
})
export class ChildrenModule {}
