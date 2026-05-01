import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { ScheduleModule } from '@nestjs/schedule';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { OrganizationModule } from './organization/organization.module';
import { CommunityModule } from './community/community.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { ConversationsModule } from './conversations/conversations.module';
import { AvailabilitiesModule } from './availabilities/availabilities.module';
import { ChildrenModule } from './children/children.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { GamificationModule } from './gamification/gamification.module';
import { VolunteersModule } from './volunteers/volunteers.module';
import { CoursesModule } from './courses/courses.module';
import { CertificationTestModule } from './certification-test/certification-test.module';
import { NutritionModule } from './nutrition/nutrition.module';
import { CallsModule } from './calls/calls.module';
import { EngagementModule } from './engagement/engagement.module';
import { DonationsModule } from './donations/donations.module';
import { PaypalModule } from './paypal/paypal.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrgScanAiModule } from './orgScanAi/orgScanAi.module';
import { ImportModule } from './import/import.module';

import { SpecializedPlansModule } from './specialized-plans/specialized-plans.module';
import { ProgressAiModule } from './progress-ai/progress-ai.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { HealthcareCabinetsModule } from './healthcare-cabinets/healthcare-cabinets.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { TrainingModule } from './training/training.module';
import { ReelsModule } from './reels/reels.module';
import { FamilyDailyScheduleModule } from './family-daily-schedule/family-daily-schedule.module';
import { ConsultationSlotsModule } from './consultation-slots/consultation-slots.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AdminSeoModule } from './admin-seo/admin-seo.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';

const metricsEnabled = process.env.METRICS_ENABLED === 'true';

@Module({
  imports: [
    // Configuration module
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 120, // baseline for authenticated/public routes
      },
    ]),

    // Health checks
    TerminusModule,

    // Task scheduling (cron jobs for appointment reminders)
    ScheduleModule.forRoot(),

    // Metrics endpoint for Prometheus scraping
    ...(metricsEnabled
      ? [
          PrometheusModule.register({
            path: '/metrics',
            defaultMetrics: {
              enabled: true,
            },
          }),
        ]
      : []),

    // Application modules
    DatabaseModule,
    MailModule,
    AuthModule,
    UsersModule,
    HealthModule,
    OrganizationModule,
    CommunityModule,
    MarketplaceModule,
    ConversationsModule,
    AvailabilitiesModule,
    ChildrenModule,
    CloudinaryModule,
    GamificationModule,
    VolunteersModule,
    CoursesModule,
    CertificationTestModule,
    NutritionModule,
    CallsModule,
    EngagementModule,
    DonationsModule,
    PaypalModule,
    NotificationsModule,
    OrgScanAiModule,
    ImportModule,
    SpecializedPlansModule,
    ProgressAiModule,
    ChatbotModule,
    HealthcareCabinetsModule,
    IntegrationsModule,
    TrainingModule,
    ReelsModule,
    FamilyDailyScheduleModule,
    ConsultationSlotsModule,
    AppointmentsModule,
    AdminSeoModule,
    SupportTicketsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
