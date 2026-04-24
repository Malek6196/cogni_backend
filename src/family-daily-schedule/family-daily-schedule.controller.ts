import {
  Body,
  Controller,
  Get,
  Post,
  Put,
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
import { FamilyDailyScheduleService } from './family-daily-schedule.service';
import { GenerateDailyScheduleDto } from './dto/generate-daily-schedule.dto';
import { UpdateFamilyRoutinePreferencesDto } from './dto/update-family-routine-preferences.dto';
import { ConfirmDailyScheduleDto } from './dto/confirm-daily-schedule.dto';

@ApiTags('family-daily-schedule')
@Controller('family-daily-schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('family')
@ApiBearerAuth('JWT-auth')
export class FamilyDailyScheduleController {
  constructor(private readonly scheduleService: FamilyDailyScheduleService) {}

  @Post('generate')
  @ApiOperation({
    summary:
      'Génère le planning quotidien (IA + météo + rappels + RDV optionnels)',
  })
  async generate(
    @Request() req: { user: { id: string } },
    @Body() dto: GenerateDailyScheduleDto,
  ) {
    return this.scheduleService.generate(req.user.id, dto);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Préférences de routine (réveil, repas, coucher)' })
  @ApiQuery({ name: 'childId', required: false })
  async getPreferences(
    @Request() req: { user: { id: string } },
    @Query('childId') childId?: string,
  ) {
    return this.scheduleService.getPreferences(req.user.id, childId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Met à jour les préférences de routine' })
  async putPreferences(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateFamilyRoutinePreferencesDto,
  ) {
    return this.scheduleService.upsertPreferences(req.user.id, dto);
  }

  @Post('confirm')
  @ApiOperation({
    summary:
      'Confirme le plan et enregistre les horaires (personnalisation progressive)',
  })
  async confirm(
    @Request() req: { user: { id: string } },
    @Body() dto: ConfirmDailyScheduleDto,
  ) {
    return this.scheduleService.confirmPlan(req.user.id, dto);
  }
}
