import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { DEFAULT_CRAWLER_AGENTS } from '../admin-seo.constants';

export type SeoControlConfigDocument = SeoControlConfig & Document;

@Schema({ _id: false })
export class CrawlerPolicy {
  @Prop({ required: true })
  userAgent: string;

  @Prop({ type: [String], default: [] })
  allow: string[];

  @Prop({ type: [String], default: [] })
  disallow: string[];

  @Prop({ type: Number, default: null })
  crawlDelay?: number | null;

  @Prop({ default: true })
  enabled: boolean;
}

@Schema({ _id: false })
export class GithubActionsConfig {
  @Prop({ default: '' })
  repository: string;

  @Prop({ default: 'main' })
  branch: string;

  @Prop({ default: '' })
  lighthouseWorkflowId: string;

  @Prop({ default: '' })
  zapWorkflowId: string;

  @Prop({ default: '' })
  tokenSecretRef: string;
}

@Schema({ _id: false })
export class JenkinsConfig {
  @Prop({ default: '' })
  baseUrl: string;

  @Prop({ default: '' })
  jobName: string;

  @Prop({ default: '' })
  usernameSecretRef: string;

  @Prop({ default: '' })
  apiTokenSecretRef: string;
}

@Schema({ _id: false })
export class SearchConsoleConfig {
  @Prop({ default: '' })
  propertyUri: string;

  @Prop({ default: '' })
  credentialsSecretRef: string;

  @Prop({ default: '' })
  sitemapUrl: string;
}

@Schema({ _id: false })
export class SentryConfig {
  @Prop({ default: '' })
  dsnSecretRef: string;

  @Prop({ default: 'production' })
  environment: string;
}

export const CrawlerPolicySchema = SchemaFactory.createForClass(CrawlerPolicy);
export const GithubActionsConfigSchema =
  SchemaFactory.createForClass(GithubActionsConfig);
export const JenkinsConfigSchema = SchemaFactory.createForClass(JenkinsConfig);
export const SearchConsoleConfigSchema =
  SchemaFactory.createForClass(SearchConsoleConfig);
export const SentryConfigSchema = SchemaFactory.createForClass(SentryConfig);

@Schema({ collection: 'seo_control_config', timestamps: true })
export class SeoControlConfig {
  @Prop({ default: '' })
  siteOrigin: string;

  @Prop({ type: [String], default: [] })
  publicRoutes: string[];

  @Prop({ type: [String], default: [] })
  allowedCrawlerAgents: string[];

  @Prop({ default: false })
  allowUnknownCrawlerAgents: boolean;

  @Prop({
    type: [CrawlerPolicySchema],
    default: DEFAULT_CRAWLER_AGENTS.map((userAgent) => ({
      userAgent,
      allow: ['/'],
      disallow: [],
      enabled: true,
    })),
  })
  crawlerPolicies: CrawlerPolicy[];

  @Prop({ type: GithubActionsConfigSchema, default: () => ({}) })
  githubActions: GithubActionsConfig;

  @Prop({ type: JenkinsConfigSchema, default: () => ({}) })
  jenkins: JenkinsConfig;

  @Prop({ type: SearchConsoleConfigSchema, default: () => ({}) })
  searchConsole: SearchConsoleConfig;

  @Prop({ type: SentryConfigSchema, default: () => ({}) })
  sentry: SentryConfig;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SeoControlConfigSchema =
  SchemaFactory.createForClass(SeoControlConfig);
