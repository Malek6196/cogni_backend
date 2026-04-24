import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/** Chemin Engine.IO distinct de `CallsGateway` (/socket.io) pour éviter
 * handleUpgrade() twice — crash Render (502/503). */
@WebSocketGateway({
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowedOrigins =
        process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) || [];
      // Allow requests with no origin (mobile apps, curl)
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  },
  namespace: '/appointments',
  path: '/socket-appointments',
  transports: ['websocket', 'polling'],
})
export class AppointmentsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AppointmentsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected to appointments gateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(
      `Client disconnected from appointments gateway: ${client.id}`,
    );
  }

  /** Client subscribes to updates for a specific provider's slots */
  @SubscribeMessage('subscribeToProvider')
  handleSubscribeToProvider(
    @MessageBody() data: { providerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `provider:${data.providerId}`;
    void client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ${room}`);
    return { event: 'subscribed', room };
  }

  @SubscribeMessage('unsubscribeFromProvider')
  handleUnsubscribeFromProvider(
    @MessageBody() data: { providerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `provider:${data.providerId}`;
    void client.leave(room);
    return { event: 'unsubscribed', room };
  }

  /** Emit to all clients watching a provider when a slot status changes */
  emitSlotUpdate(
    providerId: string,
    slotData: {
      slotId: string;
      status: string;
      date: string;
      startTime: string;
      endTime: string;
    },
  ) {
    this.server.to(`provider:${providerId}`).emit('slotUpdated', slotData);
  }

  /** Emit appointment confirmation to a specific user */
  emitAppointmentConfirmation(userId: string, appointmentData: any) {
    this.server
      .to(`user:${userId}`)
      .emit('appointmentConfirmed', appointmentData);
  }

  /** Client subscribes to their own appointment updates */
  @SubscribeMessage('subscribeToMyAppointments')
  handleSubscribeToMyAppointments(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `user:${data.userId}`;
    void client.join(room);
    return { event: 'subscribed', room };
  }

  /** Emit appointment cancellation event */
  emitAppointmentCancelled(userId: string, providerId: string, slotId: string) {
    this.server.to(`user:${userId}`).emit('appointmentCancelled', { slotId });
    this.server.to(`provider:${providerId}`).emit('slotUpdated', {
      slotId,
      status: 'available',
    });
  }
}
