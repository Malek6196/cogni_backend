import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { MailMockService } from './mail-mock.service';
import { isProductionEnvironment } from '../common/config/runtime-security.util';

@Module({
  imports: [ConfigModule],
  providers: [
    MailMockService,
    {
      provide: MailService,
      useFactory: (configService: ConfigService) => {
        const useMock = configService.get<boolean>('USE_MOCK_EMAIL');
        const hasApiKey = !!configService.get<string>('SENDGRID_API_KEY');
        const hasMailFrom = !!configService.get<string>('MAIL_FROM');
        const production = isProductionEnvironment();

        if (production && useMock) {
          throw new Error('USE_MOCK_EMAIL must not be enabled in production.');
        }

        if (production && (!hasApiKey || !hasMailFrom)) {
          throw new Error(
            'SENDGRID_API_KEY and MAIL_FROM must be configured in production.',
          );
        }

        if (useMock || (!hasApiKey && !production)) {
          console.log('📬 MailModule: Using MailMockService');
          return new MailMockService();
        }

        console.log('🚀 MailModule: Using real MailService');
        return new MailService(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: [MailService],
})
export class MailModule {}
