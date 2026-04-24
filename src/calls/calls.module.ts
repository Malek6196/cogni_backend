import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsGateway } from './calls.gateway';
import { TranscriptionService } from './transcription.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { getJwtSecret } from '../common/config/runtime-security.util';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => ConversationsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: getJwtSecret(config.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway, TranscriptionService],
  exports: [CallsService, CallsGateway, TranscriptionService],
})
export class CallsModule {}
