import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getMongoDbUri } from '../common/config/runtime-security.util';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: getMongoDbUri(configService.get<string>('MONGODB_URI')),
        // Connection pool settings for production
        maxPoolSize: 50, // Maximum connections in pool
        minPoolSize: 10, // Keep warm connections ready
        serverSelectionTimeoutMS: 5000, // Fail fast if DB unavailable
        heartbeatFrequencyMS: 10000, // Check connection health every 10s
        retryWrites: true, // Retry failed writes
        w: 'majority', // Wait for majority replica ack
      }),
    }),
  ],
})
export class DatabaseModule {}
