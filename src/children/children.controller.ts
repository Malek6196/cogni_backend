import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { buildImageUploadOptions } from '../common/upload/multer-upload-options';
import { ChildrenService } from './children.service';
import { AddChildDto } from './dto/add-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { CreateFamilyDto } from '../organization/dto/create-family.dto';

@ApiTags('children')
@Controller('children')
export class ChildrenController {
  constructor(private readonly childrenService: ChildrenService) {}

  @Get()
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Get children for a family (GET /children?familyId=xxx or own if family)',
  })
  async getChildren(@Request() req: any, @Query('familyId') familyId?: string) {
    const userId = req.user.id as string;
    const role = (req.user.role as string)?.toLowerCase?.();
    const targetFamilyId =
      familyId?.trim() || (role === 'family' ? userId : undefined);
    if (!targetFamilyId) {
      return [];
    }
    return this.childrenService.findByFamilyId(targetFamilyId, userId);
  }

  @Post()
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('family')
  @ApiOperation({ summary: 'Add a child (family only)' })
  async addChild(@Request() req: any, @Body() body: AddChildDto) {
    const userId = req.user.id as string;
    return this.childrenService.createForFamily(userId, userId, body);
  }

  // ── Specialist Private Children ──

  @Get('specialist/my-children')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    'psychologist',
    'speech_therapist',
    'occupational_therapist',
    'doctor',
    'ergotherapist',
  )
  @ApiOperation({ summary: 'Get private children added by this specialist' })
  async getSpecialistChildren(@Request() req: any) {
    return this.childrenService.findBySpecialistId(req.user.id as string);
  }

  @Get('specialist/my-patients')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    'careProvider',
    'psychologist',
    'speech_therapist',
    'occupational_therapist',
    'doctor',
    'ergotherapist',
  )
  @ApiOperation({
    summary:
      'Get my patients (children) from real bookings (appointments) - specialist only',
  })
  async getMyPatients(@Request() req: any): Promise<unknown> {
    if ((req.user.role as string) === 'careProvider') {
      await this.childrenService.assertCareProviderIsSpecialist(
        req.user.id as string,
      );
    }
    return this.childrenService.listPatientsForSpecialistFromAppointments(
      req.user.id as string,
    );
  }

  @Post('specialist/add-child')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    'psychologist',
    'speech_therapist',
    'occupational_therapist',
    'doctor',
    'ergotherapist',
  )
  @ApiOperation({ summary: 'Add a private child (specialist only)' })
  async addSpecialistChild(@Request() req: any, @Body() body: AddChildDto) {
    return this.childrenService.createForSpecialist(
      req.user.id as string,
      body,
    );
  }

  @Post('specialist/add-family')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    'psychologist',
    'speech_therapist',
    'occupational_therapist',
    'doctor',
    'ergotherapist',
  )
  @ApiOperation({
    summary: 'Add a private family and their children (specialist only)',
  })
  async addSpecialistFamily(
    @Request() req: any,
    @Body() body: CreateFamilyDto,
  ) {
    return this.childrenService.createPrivateFamily(
      req.user.id as string,
      body,
    );
  }

  @Patch(':id')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update child data' })
  async updateChild(
    @Request() req: any,
    @Param('id') childId: string,
    @Body() dto: UpdateChildDto,
  ) {
    return this.childrenService.updateChild(
      childId,
      req.user.id as string,
      dto,
    );
  }

  @Patch(':id/profile-picture')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', buildImageUploadOptions()))
  @ApiOperation({ summary: 'Upload child profile picture' })
  async uploadChildProfilePicture(
    @Request() req: any,
    @Param('id') childId: string,
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname?: string },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.childrenService.uploadChildProfilePicture(
      childId,
      req.user.id as string,
      file,
    );
  }
}
