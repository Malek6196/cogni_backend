import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SupportTicket,
  SupportTicketDocument,
} from './schemas/support-ticket.schema';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class SupportTicketsService {
  constructor(
    @InjectModel(SupportTicket.name)
    private readonly ticketModel: Model<SupportTicketDocument>,
  ) {}

  async create(
    userId: string,
    role: string,
    dto: CreateTicketDto,
  ): Promise<SupportTicketDocument> {
    const ticket = new this.ticketModel({
      userId: new Types.ObjectId(userId),
      role,
      type: dto.type,
      subject: dto.subject,
      description: dto.description,
      priority: dto.priority,
      attachments: dto.attachments ?? [],
      status: 'open',
      messages: [
        {
          sender: 'user',
          message: dto.description,
          createdAt: new Date(),
        },
      ],
    });
    return ticket.save();
  }

  async findMyTickets(userId: string): Promise<SupportTicketDocument[]> {
    return this.ticketModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(
    ticketId: string,
    userId: string,
  ): Promise<SupportTicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId).exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId.toString() !== userId)
      throw new ForbiddenException('Access denied');
    return ticket;
  }

  async addUserMessage(
    ticketId: string,
    userId: string,
    dto: AddMessageDto,
  ): Promise<SupportTicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId).exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId.toString() !== userId)
      throw new ForbiddenException('Access denied');

    ticket.messages.push({
      sender: 'user',
      message: dto.message,
      createdAt: new Date(),
    });
    return ticket.save();
  }

  // ── Admin methods ──────────────────────────────────────────────────

  /** All granular roles that belong to the careProvider umbrella */
  private static readonly CARE_PROVIDER_ROLES = [
    'careProvider',
    'doctor',
    'volunteer',
    'psychologist',
    'speech_therapist',
    'occupational_therapist',
    'ergotherapist',
    'caregiver',
  ] as const;

  async findAll(
    page = 1,
    limit = 20,
    status?: string,
    type?: string,
    role?: string,
  ): Promise<{ tickets: SupportTicketDocument[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (role === 'careProvider') {
      // Match all care-provider sub-roles stored in the ticket
      filter.role = { $in: SupportTicketsService.CARE_PROVIDER_ROLES };
    } else if (role) {
      filter.role = role;
    }

    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .populate('userId', 'fullName email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.ticketModel.countDocuments(filter),
    ]);
    return { tickets, total };
  }

  async updateStatus(
    ticketId: string,
    dto: UpdateStatusDto,
  ): Promise<SupportTicketDocument> {
    const ticket = await this.ticketModel
      .findByIdAndUpdate(ticketId, { status: dto.status }, { new: true })
      .exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async addAdminMessage(
    ticketId: string,
    dto: AddMessageDto,
  ): Promise<SupportTicketDocument> {
    const ticket = await this.ticketModel.findById(ticketId).exec();
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.messages.push({
      sender: 'admin',
      message: dto.message,
      createdAt: new Date(),
    });
    return ticket.save();
  }

  async deleteTicket(ticketId: string, userId: string): Promise<void> {
    const ticket = await this.ticketModel.findById(ticketId).exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId.toString() !== userId) throw new ForbiddenException('Access denied');
    await this.ticketModel.findByIdAndDelete(ticketId).exec();
  }

  async deleteTicketAdmin(ticketId: string): Promise<void> {
    const ticket = await this.ticketModel.findByIdAndDelete(ticketId).exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
  }
}
