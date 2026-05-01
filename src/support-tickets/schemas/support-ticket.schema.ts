import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupportTicketDocument = SupportTicket & Document;

export class TicketMessage {
  @Prop({ required: true, enum: ['user', 'admin'] })
  sender!: 'user' | 'admin';

  @Prop({ required: true })
  message!: string;

  @Prop({ default: () => new Date() })
  createdAt!: Date;
}

@Schema({ timestamps: true })
export class SupportTicket {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  role!: string;

  @Prop({ required: true, enum: ['bug', 'suggestion', 'contact'] })
  type!: 'bug' | 'suggestion' | 'contact';

  @Prop({ required: true })
  subject!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({
    required: true,
    enum: ['open', 'in_progress', 'resolved'],
    default: 'open',
    index: true,
  })
  status!: 'open' | 'in_progress' | 'resolved';

  @Prop({ enum: ['low', 'medium', 'urgent'] })
  priority?: 'low' | 'medium' | 'urgent';

  @Prop({
    type: [
      {
        sender: { type: String, enum: ['user', 'admin'], required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, default: () => new Date() },
      },
    ],
    default: [],
  })
  messages!: TicketMessage[];

  @Prop({ type: [String], default: [] })
  attachments!: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
SupportTicketSchema.index({ createdAt: -1 });
SupportTicketSchema.index({ userId: 1, createdAt: -1 });
SupportTicketSchema.index({ status: 1, type: 1 });
