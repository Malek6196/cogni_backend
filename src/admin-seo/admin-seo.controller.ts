import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminSeoService } from './admin-seo.service';
import {
  SeoControlPlaneDto,
  UpdateSeoControlPlaneDto,
} from './dto/seo-control-plane.dto';
import {
  SeoActionHistoryQueryDto,
  SeoActionHistoryResponseDto,
  SeoActionRequestDto,
  SeoActionResultDto,
  SeoToolStatusResponseDto,
} from './dto/seo-action.dto';

@ApiTags('admin-seo')
@ApiBearerAuth('JWT-auth')
@Controller('admin/seo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminSeoController {
  constructor(private readonly adminSeoService: AdminSeoService) {}

  @Get('control-plane')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get the admin SEO control plane state.' })
  getControlPlane(): Promise<SeoControlPlaneDto> {
    return this.adminSeoService.getControlPlane();
  }

  @Patch('control-plane')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Update admin SEO control plane configuration.' })
  updateControlPlane(
    @Body() updateDto: UpdateSeoControlPlaneDto,
    @Request() req: { user: { id: string; role: string } },
  ): Promise<SeoControlPlaneDto> {
    return this.adminSeoService.updateControlPlane(updateDto, req.user);
  }

  @Post('actions')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @ApiOperation({ summary: 'Queue an asynchronous admin SEO action.' })
  queueAction(
    @Body() actionDto: SeoActionRequestDto,
    @Request() req: { user: { id: string; role: string } },
  ): Promise<SeoActionResultDto> {
    return this.adminSeoService.queueAction(actionDto, req.user);
  }

  @Get('actions/history')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get SEO action history with cursor pagination.' })
  getActionHistory(
    @Query() query: SeoActionHistoryQueryDto,
  ): Promise<SeoActionHistoryResponseDto> {
    return this.adminSeoService.getActionHistory(query);
  }

  @Get('tools/status')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get SEO tool integration status overview.' })
  getToolStatuses(): Promise<SeoToolStatusResponseDto> {
    return this.adminSeoService.getToolStatuses();
  }
}
