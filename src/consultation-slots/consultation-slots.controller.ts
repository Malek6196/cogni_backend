import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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
import { ConsultationSlotsService } from './consultation-slots.service';
import {
  BulkCreateSlotsDto,
  BlockSlotDto,
  CreateConsultationSlotDto,
} from './dto/create-consultation-slot.dto';
import type { ConsultationType } from './schemas/consultation-slot.schema';

@ApiTags('consultation-slots')
@Controller('consultation-slots')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
export class ConsultationSlotsController {
  constructor(private readonly slotsService: ConsultationSlotsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a single consultation slot (provider only)',
  })
  async createSlot(
    @Request() req: { user: { id: string; role: string } },
    @Body() dto: CreateConsultationSlotDto,
  ): Promise<unknown> {
    return this.slotsService.createSlot(req.user.id, req.user.role, dto);
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Bulk-create slots from working hours (provider only)',
  })
  async bulkCreate(
    @Request() req: { user: { id: string; role: string } },
    @Body() dto: BulkCreateSlotsDto,
  ): Promise<unknown> {
    return this.slotsService.bulkCreateSlots(req.user.id, req.user.role, dto);
  }

  @Post('block')
  @ApiOperation({ summary: 'Block a time range (provider only)' })
  async block(
    @Request() req: { user: { id: string; role: string } },
    @Body() dto: BlockSlotDto,
  ): Promise<unknown> {
    return this.slotsService.blockTimeRange(req.user.id, req.user.role, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get my slots (provider)' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Filter by YYYY-MM-DD',
  })
  async listMine(
    @Request() req: { user: { id: string } },
    @Query('date') date?: string,
  ) {
    return this.slotsService.listByProvider(req.user.id, date);
  }

  @Get('mine/calendar')
  @ApiOperation({
    summary: 'Get my slots for a date range (provider calendar view)',
  })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async mineCalendar(
    @Request() req: { user: { id: string } },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.slotsService.listSlotsForCalendar(
      req.user.id,
      startDate,
      endDate,
    );
  }

  @Get('providers')
  @ApiOperation({
    summary: 'List available providers by consultation type (for booking)',
  })
  @ApiQuery({
    name: 'consultationType',
    required: true,
    enum: ['doctor', 'volunteer', 'organization_staff'],
  })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'language', required: false })
  async listProviders(
    @Query('consultationType') consultationType: ConsultationType,
    @Query('date') date?: string,
    @Query('language') language?: string,
  ) {
    return this.slotsService.listAvailableProviders(
      consultationType,
      date,
      language,
    );
  }

  @Get('provider/:providerId/available')
  @ApiOperation({ summary: 'List available slots for a specific provider' })
  @ApiQuery({ name: 'date', required: false })
  async listAvailableForProvider(
    @Param('providerId') providerId: string,
    @Query('date') date?: string,
  ) {
    return this.slotsService.listAvailableByProvider(providerId, date);
  }

  @Get('provider/:providerId/calendar')
  @ApiOperation({
    summary: 'Get all slots for a provider (calendar view with status)',
  })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async providerCalendar(
    @Param('providerId') providerId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.slotsService.listSlotsForCalendar(
      providerId,
      startDate,
      endDate,
    );
  }

  @Delete(':slotId')
  @ApiOperation({ summary: 'Delete a slot (provider only, not booked)' })
  async deleteSlot(
    @Param('slotId') slotId: string,
    @Request() req: { user: { id: string } },
  ) {
    await this.slotsService.deleteSlot(slotId, req.user.id);
    return { message: 'Slot deleted successfully' };
  }

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Admin: list all slots with filters' })
  @ApiQuery({ name: 'consultationType', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'providerId', required: false })
  async adminListAll(
    @Query('consultationType') consultationType?: ConsultationType,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('providerId') providerId?: string,
  ) {
    return this.slotsService.adminListSlots({
      consultationType,
      status,
      date,
      providerId,
    });
  }
}
