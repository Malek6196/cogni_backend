import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { createHash } from 'crypto';
import { TranscriptionService } from './transcription.service';
import { ConversationsService } from '../conversations/conversations.service';
import { getJwtSecret } from '../common/config/runtime-security.util';

interface SocketWithUserId {
  id: string;
  userId?: string;
  emit: (event: string, data: unknown) => void;
  disconnect: (close?: boolean) => void;
  handshake: {
    auth?: { token?: string };
    headers?: {
      authorization?: string;
      origin?: string;
      'x-forwarded-for'?: string;
    };
    address?: string;
  };
}

const userIdToSocket = new Map<string, Set<string>>();

function isAllowedSocketOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    (origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:'))
  ) {
    return true;
  }

  const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return configuredOrigins.includes(origin);
}

type PendingIncomingCall = {
  fromUserId: string;
  fromUserName: string;
  channelId: string;
  isVideo: boolean;
  createdAt: number;
};

@Injectable()
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
  path: '/socket.io',
  transports: ['websocket', 'polling'],
})
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CallsGateway.name);
  private readonly pendingIncomingCalls = new Map<
    string,
    PendingIncomingCall[]
  >();

  @WebSocketServer()
  server!: Server;

  private transcriptionStreams = new Map<
    string,
    { end(): void; write(chunk: Buffer): void }
  >();
  private transcriptionLanguageByClient = new Map<string, string>();

  // Connection rate limiting: track connection attempts per IP
  private connectionAttempts = new Map<string, number[]>();
  private readonly MAX_CONNECTIONS_PER_MINUTE = 10;

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private transcriptionService: TranscriptionService,
    @Inject(forwardRef(() => ConversationsService))
    private conversationsService: ConversationsService,
  ) {}

  /**
   * Hash user ID for safe logging (non-reversible)
   */
  private hashUserId(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').substring(0, 12);
  }

  private hashLogValue(value: string | undefined): string {
    if (!value) return 'unknown';
    return createHash('sha256').update(value).digest('hex').substring(0, 12);
  }

  private async assertCanSignal(
    client: SocketWithUserId,
    targetUserId: string | undefined,
    eventName: string,
  ): Promise<boolean> {
    if (!client.userId || !targetUserId) return false;
    try {
      await this.conversationsService.assertUsersCanCommunicate(
        client.userId,
        targetUserId,
      );
      return true;
    } catch {
      this.logger.warn(
        `[CALL] ${eventName} denied from=${this.hashUserId(client.userId)} to=${this.hashLogValue(targetUserId)}`,
      );
      client.emit('call:error', { message: 'Call not allowed' });
      return false;
    }
  }

  /**
   * Check connection rate limit for IP
   */
  private checkConnectionRate(ip: string): boolean {
    const now = Date.now();
    const window = 60000; // 1 minute
    const attempts = this.connectionAttempts.get(ip) || [];
    const recentAttempts = attempts.filter((t) => now - t < window);

    if (recentAttempts.length >= this.MAX_CONNECTIONS_PER_MINUTE) {
      return false;
    }

    recentAttempts.push(now);
    this.connectionAttempts.set(ip, recentAttempts);
    return true;
  }

  handleConnection(client: SocketWithUserId) {
    this.logger.log(
      `[CALL] socket connected id=${this.hashLogValue(client.id)}`,
    );

    // Rate limit check
    const clientIp =
      client.handshake?.headers?.['x-forwarded-for'] ||
      client.handshake?.address ||
      'unknown';
    if (!this.checkConnectionRate(clientIp)) {
      this.logger.warn(
        `[CALL] Rate limit exceeded for ip=${this.hashLogValue(clientIp)}`,
      );
      client.emit('error', {
        message: 'Rate limit exceeded. Please try again later.',
      });
      client.disconnect(true);
      return;
    }

    const origin = client.handshake?.headers?.origin;
    if (!isAllowedSocketOrigin(origin)) {
      this.logger.warn(
        `[CALL] Connexion refusée: origin not allowed for socket=${this.hashLogValue(client.id)}`,
      );
      client.emit('error', { message: 'Origin not allowed' });
      client.disconnect(true);
      return;
    }

    const token =
      client.handshake?.auth?.token ??
      (client.handshake?.headers?.authorization ?? '').replace('Bearer ', '');
    if (!token) {
      client.emit('error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify(token, {
        secret: getJwtSecret(this.config.get<string>('JWT_SECRET')),
      });
      const userId = String(payload.sub ?? payload.id ?? payload.userId ?? '');
      if (!userId) throw new Error('No user id');
      client.userId = userId;
      if (!userIdToSocket.has(userId)) {
        userIdToSocket.set(userId, new Set());
      }
      userIdToSocket.get(userId)!.add(client.id);
      this.logger.log(
        `[CALL] user=${this.hashUserId(userId)} connected. Total users: ${userIdToSocket.size}`,
      );
      this.flushPendingIncomingCalls(userId);
    } catch (e) {
      this.logger.warn(`[CALL] Connexion refusée: ${e}`);
      client.emit('error', { message: 'Invalid token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: SocketWithUserId) {
    const userId = client.userId;
    this.logger.log(
      `[CALL] Disconnect socket=${this.hashLogValue(client.id)} user=${userId ? this.hashUserId(userId) : 'unknown'}`,
    );
    if (userId && userIdToSocket.has(userId)) {
      userIdToSocket.get(userId)!.delete(client.id);
      if (userIdToSocket.get(userId)!.size === 0) {
        userIdToSocket.delete(userId);
      }
    }
    const stream = this.transcriptionStreams.get(client.id);
    if (stream) {
      stream.end();
      this.transcriptionStreams.delete(client.id);
    }
    this.transcriptionLanguageByClient.delete(client.id);
  }

  @SubscribeMessage('call:transcription_language')
  handleTranscriptionLanguage(
    client: SocketWithUserId,
    payload: { language: string },
  ) {
    const lang =
      payload?.language && typeof payload.language === 'string'
        ? payload.language.trim()
        : 'multi';
    this.transcriptionLanguageByClient.set(client.id, lang);
    const stream = this.transcriptionStreams.get(client.id);
    if (stream) {
      stream.end();
      this.transcriptionStreams.delete(client.id);
    }
  }

  @SubscribeMessage('call:initiate')
  async handleCallInitiate(
    client: SocketWithUserId,
    payload: {
      targetUserId: string;
      channelId: string;
      isVideo: boolean;
      callerName: string;
    },
  ) {
    const callerId = client.userId;
    if (!callerId) return;
    if (
      !(await this.assertCanSignal(
        client,
        payload.targetUserId,
        'call:initiate',
      ))
    ) {
      return;
    }
    this.logger.log(
      `[CALL] call:initiate from=${this.hashUserId(callerId)} to=${this.hashLogValue(payload.targetUserId)} channel=${this.hashLogValue(payload.channelId)}`,
    );
    const sockets = userIdToSocket.get(payload.targetUserId);
    if (sockets && sockets.size > 0) {
      this.logger.log(
        `[CALL] Cible trouvée: ${sockets.size} socket(s), envoi call:incoming`,
      );
      for (const sid of sockets) {
        const targetSocket = this.server.sockets.sockets.get(sid);
        if (targetSocket) {
          targetSocket.emit('call:incoming', {
            fromUserId: callerId,
            fromUserName: payload.callerName,
            channelId: payload.channelId,
            isVideo: payload.isVideo,
          });
        }
      }
    } else {
      const connectedUserCount = userIdToSocket.size;
      this.logger.warn(
        `[CALL] Target not found! to=${this.hashUserId(payload.targetUserId)} not connected. Connected users: ${connectedUserCount}. Call queued.`,
      );
      this.enqueuePendingIncomingCall(payload.targetUserId, {
        fromUserId: callerId,
        fromUserName: payload.callerName,
        channelId: payload.channelId,
        isVideo: payload.isVideo,
        createdAt: Date.now(),
      });
    }
  }

  private enqueuePendingIncomingCall(
    targetUserId: string,
    call: PendingIncomingCall,
  ): void {
    const calls = this.pendingIncomingCalls.get(targetUserId) ?? [];
    const recentCalls = calls.filter(
      (pending) => Date.now() - pending.createdAt < 60_000,
    );
    recentCalls.push(call);
    this.pendingIncomingCalls.set(targetUserId, recentCalls);
  }

  private flushPendingIncomingCalls(userId: string): void {
    const calls = this.pendingIncomingCalls.get(userId);
    if (!calls || calls.length === 0) return;

    const activeCalls = calls.filter(
      (pending) => Date.now() - pending.createdAt < 60_000,
    );
    if (activeCalls.length === 0) {
      this.pendingIncomingCalls.delete(userId);
      return;
    }

    const sockets = userIdToSocket.get(userId);
    if (!sockets || sockets.size === 0) return;

    this.logger.log(
      `[CALL] Livraison de ${activeCalls.length} appel(s) en attente à user=${this.hashUserId(userId)}`,
    );

    for (const pending of activeCalls) {
      for (const sid of sockets) {
        const targetSocket = this.server.sockets.sockets.get(sid);
        if (targetSocket) {
          targetSocket.emit('call:incoming', {
            fromUserId: pending.fromUserId,
            fromUserName: pending.fromUserName,
            channelId: pending.channelId,
            isVideo: pending.isVideo,
          });
        }
      }
    }

    this.pendingIncomingCalls.delete(userId);
  }

  @SubscribeMessage('call:accept')
  async handleCallAccept(
    client: SocketWithUserId,
    payload: { fromUserId: string; channelId: string },
  ) {
    if (!client.userId) return;
    if (
      !(await this.assertCanSignal(client, payload.fromUserId, 'call:accept'))
    ) {
      return;
    }
    this.logger.log(
      `[CALL] call:accept callee=${this.hashUserId(client.userId)} from=${this.hashLogValue(payload.fromUserId)} channel=${this.hashLogValue(payload.channelId)}`,
    );
    const sockets = userIdToSocket.get(payload.fromUserId);
    if (sockets) {
      this.logger.log(`[CALL] Envoi call:accepted au caller`);
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s) s.emit('call:accepted', { channelId: payload.channelId });
      }
    } else {
      this.logger.warn(
        `[CALL] call:accept - caller=${this.hashLogValue(payload.fromUserId)} non trouvé`,
      );
    }
  }

  @SubscribeMessage('call:reject')
  async handleCallReject(
    client: SocketWithUserId,
    payload: { fromUserId: string },
  ) {
    if (!client.userId) return;
    if (
      !(await this.assertCanSignal(client, payload.fromUserId, 'call:reject'))
    ) {
      return;
    }
    const sockets = userIdToSocket.get(payload.fromUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s) s.emit('call:rejected');
      }
    }
  }

  @SubscribeMessage('call:end')
  async handleCallEnd(
    client: SocketWithUserId,
    payload: { targetUserId: string },
  ) {
    if (!client.userId) return;
    if (
      !(await this.assertCanSignal(client, payload.targetUserId, 'call:end'))
    ) {
      return;
    }
    const sockets = userIdToSocket.get(payload.targetUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s) s.emit('call:ended');
      }
    }
  }

  // ─── WebRTC Signaling ──────────────────────────────────────────────

  @SubscribeMessage('webrtc:offer')
  async handleWebRTCOffer(
    client: SocketWithUserId,
    payload: { targetUserId: string; sdp: string; type: string },
  ) {
    if (!client.userId) return;
    if (
      !(await this.assertCanSignal(
        client,
        payload.targetUserId,
        'webrtc:offer',
      ))
    ) {
      return;
    }
    this.logger.log(
      `[WEBRTC] offer from=${this.hashUserId(client.userId)} to=${this.hashLogValue(payload.targetUserId)}`,
    );
    const sockets = userIdToSocket.get(payload.targetUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s)
          s.emit('webrtc:offer', {
            fromUserId: client.userId,
            sdp: payload.sdp,
            type: payload.type,
          });
      }
    }
  }

  @SubscribeMessage('webrtc:answer')
  async handleWebRTCAnswer(
    client: SocketWithUserId,
    payload: { targetUserId: string; sdp: string; type: string },
  ) {
    if (!client.userId) return;
    if (
      !(await this.assertCanSignal(
        client,
        payload.targetUserId,
        'webrtc:answer',
      ))
    ) {
      return;
    }
    this.logger.log(
      `[WEBRTC] answer from=${this.hashUserId(client.userId)} to=${this.hashLogValue(payload.targetUserId)}`,
    );
    const sockets = userIdToSocket.get(payload.targetUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s)
          s.emit('webrtc:answer', {
            fromUserId: client.userId,
            sdp: payload.sdp,
            type: payload.type,
          });
      }
    }
  }

  @SubscribeMessage('webrtc:ice-candidate')
  async handleWebRTCIceCandidate(
    client: SocketWithUserId,
    payload: {
      targetUserId: string;
      candidate: string;
      sdpMid: string;
      sdpMLineIndex: number;
    },
  ) {
    if (!client.userId) return;
    if (
      !(await this.assertCanSignal(
        client,
        payload.targetUserId,
        'webrtc:ice-candidate',
      ))
    ) {
      return;
    }
    const sockets = userIdToSocket.get(payload.targetUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s)
          s.emit('webrtc:ice-candidate', {
            fromUserId: client.userId,
            candidate: payload.candidate,
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex,
          });
      }
    }
  }

  @SubscribeMessage('call:audio_chunk')
  async handleAudioChunk(
    client: SocketWithUserId,
    payload: { targetUserId: string; chunk: Buffer; channelId: string },
  ) {
    if (!client.userId) return;
    if (
      !(await this.assertCanSignal(
        client,
        payload.targetUserId,
        'call:audio_chunk',
      ))
    ) {
      return;
    }

    let stream = this.transcriptionStreams.get(client.id);
    if (!stream) {
      const lang = this.transcriptionLanguageByClient.get(client.id) || 'multi';
      stream = this.transcriptionService.createStream(
        {
          onTranscription: (text: string, isFinal: boolean) => {
            // Broadcast translation to target and back to sender
            const transcriptionPayload = {
              fromUserId: client.userId,
              text,
              isFinal,
              channelId: payload.channelId,
            };

            client.emit('call:transcription', transcriptionPayload);
            const targetSockets = userIdToSocket.get(payload.targetUserId);
            if (targetSockets) {
              for (const sid of targetSockets) {
                const s = this.server.sockets.sockets.get(sid);
                if (s) s.emit('call:transcription', transcriptionPayload);
              }
            }

            // Persist each final transcript line as a regular chat message.
            // IMPORTANT: channelId is a WebRTC/call id, not a conversation id.
            if (
              isFinal &&
              payload.targetUserId &&
              typeof text === 'string' &&
              text.trim().length > 0
            ) {
              void this.conversationsService
                .getOrCreateConversation(client.userId!, payload.targetUserId)
                .then((conv) =>
                  this.conversationsService.addMessage(
                    conv.id,
                    client.userId!,
                    text.trim(),
                  ),
                )
                .catch((e: Error) => {
                  this.logger.error(
                    `Failed to save transcription in conversation: ${e.message}`,
                  );
                });
            }
          },
          onError: (err) => {
            this.logger.error(
              `Transcription stream error for socket=${this.hashLogValue(client.id)}: ${err.message}`,
            );
            this.transcriptionStreams.delete(client.id);
          },
        },
        lang,
      );

      if (stream) {
        this.transcriptionStreams.set(client.id, stream);
      }
    }

    if (stream) {
      stream.write(payload.chunk);
    }
  }

  @SubscribeMessage('chat:typing')
  handleChatTyping(
    client: SocketWithUserId,
    payload: {
      targetUserId: string;
      conversationId: string;
      isTyping: boolean;
    },
  ) {
    if (!client.userId) return;
    const sockets = userIdToSocket.get(payload.targetUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s) {
          s.emit('chat:typing', {
            userId: client.userId,
            conversationId: payload.conversationId,
            isTyping: payload.isTyping,
          });
        }
      }
    }
  }

  /** Emit message:new to a user (for in-app notifications when they receive a chat message). */
  emitMessageNew(
    targetUserId: string,
    payload: {
      senderId: string;
      senderName: string;
      preview: string;
      text?: string;
      attachmentUrl?: string;
      attachmentType?: 'image' | 'voice' | 'call_missed' | 'call_summary';
      callDuration?: number;
      conversationId: string;
      messageId?: string;
      createdAt?: string;
    },
  ) {
    const sockets = userIdToSocket.get(targetUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s) s.emit('message:new', payload);
      }
      this.logger.log(
        `[CALL] message:new envoyé à target=${this.hashLogValue(targetUserId)}`,
      );
    }
  }

  /** Notify clients to remove a message from the thread (e.g. after delete). */
  emitMessageDeleted(
    targetUserId: string,
    payload: { conversationId: string; messageId: string },
  ) {
    const sockets = userIdToSocket.get(targetUserId);
    if (sockets) {
      for (const sid of sockets) {
        const s = this.server.sockets.sockets.get(sid);
        if (s) s.emit('message:deleted', payload);
      }
      this.logger.log(
        `[CALL] message:deleted envoyé à target=${this.hashLogValue(targetUserId)} message=${this.hashLogValue(payload.messageId)}`,
      );
    }
  }
}
