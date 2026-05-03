import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AvailabilitiesService } from './availabilities.service';

const AVAILABILITY_PUBLISHER_ROLES = new Set([
  'volunteer',
  'careprovider',
  'doctor',
  'psychologist',
  'speech_therapist',
  'occupational_therapist',
  'ergotherapist',
  'healthcare',
  'professional',
]);

@ApiTags('availabilities')
@Controller('availabilities')
export class AvailabilitiesController {
  constructor(private readonly availabilitiesService: AvailabilitiesService) {}

  private canManageAvailability(role: string | undefined): boolean {
    return role != null && AVAILABILITY_PUBLISHER_ROLES.has(role);
  }

  @Post()
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Publish availability (volunteer, care provider, specialist)',
  })
  async create(@Request() req: any, @Body() body: any) {
    const userId = req.user.id as string;
    const role = (req.user.role as string)?.toLowerCase?.();
    if (!this.canManageAvailability(role)) {
      throw new ForbiddenException(
        'Only volunteers, care providers, and specialists can publish availability',
      );
    }
    const dates = Array.isArray(body.dates) ? body.dates : [];
    if (dates.length === 0) {
      throw new BadRequestException('At least one date is required');
    }
    return this.availabilitiesService.create(userId, {
      dates,
      startTime: body.startTime,
      endTime: body.endTime,
      recurrence: body.recurrence,
      recurrenceOn: body.recurrenceOn,
    });
  }

  @Get()
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List my availabilities (volunteer, care provider, specialist)',
  })
  async listMine(@Request() req: any) {
    const userId = req.user.id as string;
    const role = (req.user.role as string)?.toLowerCase?.();
    if (!this.canManageAvailability(role)) {
      throw new ForbiddenException(
        'Only volunteers, care providers, and specialists can list their availabilities',
      );
    }
    return this.availabilitiesService.listByVolunteerId(userId);
  }

  @Get('for-families')
  @ApiOperation({
    summary: 'List availabilities for family home (public or auth)',
  })
  async listForFamilies() {
    return this.availabilitiesService.listForFamilies();
  }
}
