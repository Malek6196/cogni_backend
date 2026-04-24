import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppointmentsService } from './appointments.service';
import {
  CancelAppointmentDto,
  CompleteAppointmentDto,
  CreateAppointmentDto,
  RateAppointmentDto,
} from './dto/create-appointment.dto';
import type { AppointmentStatus } from './schemas/appointment.schema';

@ApiTags('appointments')
@Controller('appointments')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  /** Book a consultation slot */
  @Post()
  @ApiOperation({ summary: 'Book a consultation slot (family role)' })
  async create(
    @Request() req: { user: { id: string; email: string; fullName?: string } },
    @Body() dto: CreateAppointmentDto,
  ): Promise<unknown> {
    return this.appointmentsService.createAppointment(
      req.user.id,
      req.user.email,
      req.user.fullName ?? req.user.email,
      dto,
    );
  }

  /** User: list my appointments */
  @Get('my')
  @ApiOperation({ summary: 'List my bookings (user)' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'confirmed', 'cancelled', 'completed', 'rescheduled'],
  })
  async listMy(
    @Request() req: { user: { id: string } },
    @Query('status') status?: AppointmentStatus,
  ): Promise<unknown> {
    return this.appointmentsService.listUserAppointments(req.user.id, status);
  }

  /** Provider: list appointments assigned to me */
  @Get('provider/mine')
  @ApiOperation({ summary: 'List appointments for provider' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'date', required: false })
  async listProviderMine(
    @Request() req: { user: { id: string } },
    @Query('status') status?: AppointmentStatus,
    @Query('date') date?: string,
  ): Promise<unknown> {
    return this.appointmentsService.listProviderAppointments(
      req.user.id,
      status,
      date,
    );
  }

  /** Get single appointment details */
  @Get(':id')
  @ApiOperation({ summary: 'Get appointment details' })
  async getOne(
    @Param('id') id: string,
    @Request() req: { user: { id: string; role: string } },
  ): Promise<unknown> {
    return this.appointmentsService.getAppointmentById(
      id,
      req.user.id,
      req.user.role,
    );
  }

  /** Cancel an appointment */
  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel an appointment (user, provider, or admin)' })
  async cancel(
    @Param('id') id: string,
    @Request() req: { user: { id: string; role: string } },
    @Body() dto: CancelAppointmentDto,
  ): Promise<unknown> {
    return this.appointmentsService.cancelAppointment(
      id,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  /** Provider: mark appointment as completed */
  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark appointment as completed (provider only)' })
  async complete(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Body() dto: CompleteAppointmentDto,
  ): Promise<unknown> {
    return this.appointmentsService.completeAppointment(id, req.user.id, dto);
  }

  /** User: rate a completed appointment */
  @Patch(':id/rate')
  @ApiOperation({ summary: 'Rate a completed appointment (user only)' })
  async rate(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Body() dto: RateAppointmentDto,
  ): Promise<unknown> {
    return this.appointmentsService.rateAppointment(id, req.user.id, dto);
  }

  /** Admin: list all appointments */
  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: list all appointments with filters' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'consultationType', required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'providerId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async adminListAll(
    @Query('status') status?: string,
    @Query('consultationType') consultationType?: string,
    @Query('date') date?: string,
    @Query('userId') userId?: string,
    @Query('providerId') providerId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.appointmentsService.adminListAppointments({
      status,
      consultationType,
      date,
      userId,
      providerId,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }
}
