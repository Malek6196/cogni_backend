import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AdminSeoController } from './admin-seo.controller';
import { AdminSeoService } from './admin-seo.service';
import {
  SeoControlConfig,
  SeoControlConfigSchema,
} from './schemas/seo-control-config.schema';
import {
  SeoActionAudit,
  SeoActionAuditSchema,
} from './schemas/seo-action-audit.schema';
import { SeoJobRun, SeoJobRunSchema } from './schemas/seo-job-run.schema';
import { GithubActionsConnector } from './connectors/github-actions.connector';
import { JenkinsConnector } from './connectors/jenkins.connector';
import { SearchConsoleConnector } from './connectors/search-console.connector';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: SeoControlConfig.name, schema: SeoControlConfigSchema },
      { name: SeoActionAudit.name, schema: SeoActionAuditSchema },
      { name: SeoJobRun.name, schema: SeoJobRunSchema },
    ]),
  ],
  controllers: [AdminSeoController],
  providers: [
    AdminSeoService,
    GithubActionsConnector,
    JenkinsConnector,
    SearchConsoleConnector,
  ],
  exports: [AdminSeoService],
})
export class AdminSeoModule {}
