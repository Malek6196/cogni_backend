import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SupportTicketsService } from './support-tickets.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@ApiTags('support-tickets')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportTicketsController {
  constructor(
    private readonly service: SupportTicketsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ── Upload attachment ──────────────────────────────────────────────

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a ticket attachment (image or PDF)' })
  @ApiResponse({ status: 200, description: 'Returns the uploaded file URL' })
  async uploadAttachment(
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ): Promise<{ url: string }> {
    if (!file?.buffer) throw new BadRequestException('No file provided');
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only images (JPEG, PNG, GIF, WebP) and PDF files are allowed',
      );
    }
    let url: string;
    if (file.mimetype === 'application/pdf') {
      url = await this.cloudinary.uploadRawBuffer(file.buffer, {
        folder: 'support-tickets',
        maxSizeBytes: 10 * 1024 * 1024,
      });
    } else {
      url = await this.cloudinary.uploadBuffer(file.buffer, {
        folder: 'support-tickets',
        maxSizeBytes: 5 * 1024 * 1024,
      });
    }
    return { url };
  }

  // ── User endpoints ─────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a support ticket' })
  @ApiResponse({ status: 201, description: 'Ticket created' })
  async create(
    @Request() req: { user: { id: string; role: string } },
    @Body() dto: CreateTicketDto,
  ) {
    return this.service.create(req.user.id, req.user.role, dto);
  }

  @Get('my-tickets')
  @ApiOperation({ summary: "Get the logged-in user's tickets" })
  @ApiResponse({ status: 200, description: 'List of tickets' })
  async getMyTickets(@Request() req: { user: { id: string } }) {
    return this.service.findMyTickets(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single ticket (owner only)' })
  @ApiResponse({ status: 200, description: 'Ticket details' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  async getOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.service.findOne(id, req.user.id);
  }

  @Post(':id/message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a message to a ticket (user)' })
  @ApiResponse({ status: 200, description: 'Message added' })
  async addUserMessage(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
  ) {
    return this.service.addUserMessage(id, req.user.id, dto);
  }

  // ── Admin endpoints ────────────────────────────────────────────────

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: '[Admin] Get all tickets with optional filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiResponse({ status: 200, description: 'Paginated ticket list' })
  async getAllTickets(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('role') role?: string,
  ) {
    return this.service.findAll(page, limit, status, type, role);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: '[Admin] Update ticket status' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.service.updateStatus(id, dto);
  }

  @Post(':id/admin-message')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: '[Admin] Reply to a ticket' })
  @ApiResponse({ status: 200, description: 'Message added' })
  async addAdminMessage(@Param('id') id: string, @Body() dto: AddMessageDto) {
    return this.service.addAdminMessage(id, dto);
  }

  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: '[Admin] Delete any ticket' })
  @ApiResponse({ status: 204, description: 'Ticket deleted' })
  async deleteTicketAdmin(@Param('id') id: string) {
    return this.service.deleteTicketAdmin(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete own ticket' })
  @ApiResponse({ status: 204, description: 'Ticket deleted' })
  async deleteTicket(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.service.deleteTicket(id, req.user.id);
  }
}
