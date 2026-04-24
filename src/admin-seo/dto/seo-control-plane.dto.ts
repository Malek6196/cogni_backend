import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SeoToolName, SeoToolStatusState } from '../admin-seo.constants';

export class CrawlerPolicyDto {
  @IsString()
  userAgent: string;

  @IsArray()
  @IsString({ each: true })
  allow: string[];

  @IsArray()
  @IsString({ each: true })
  disallow: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  crawlDelay?: number;

  @IsBoolean()
  enabled: boolean;
}

export class GithubActionsConfigDto {
  @IsOptional()
  @IsString()
  repository?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  lighthouseWorkflowId?: string;

  @IsOptional()
  @IsString()
  zapWorkflowId?: string;

  @IsOptional()
  @IsString()
  tokenSecretRef?: string;
}

export class JenkinsConfigDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  jobName?: string;

  @IsOptional()
  @IsString()
  usernameSecretRef?: string;

  @IsOptional()
  @IsString()
  apiTokenSecretRef?: string;
}

export class SearchConsoleConfigDto {
  @IsOptional()
  @IsString()
  propertyUri?: string;

  @IsOptional()
  @IsString()
  credentialsSecretRef?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  sitemapUrl?: string;
}

export class SentryConfigDto {
  @IsOptional()
  @IsString()
  dsnSecretRef?: string;

  @IsOptional()
  @IsString()
  environment?: string;
}

export class RobotsStatusDto {
  @IsOptional()
  @IsBoolean()
  exists?: boolean;

  @IsBoolean()
  managed: boolean;

  @IsBoolean()
  driftDetected: boolean;

  @IsOptional()
  @IsString()
  url?: string;

  @IsArray()
  @IsString({ each: true })
  blockedPrivatePrefixes: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];

  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}

export class SitemapStatusDto {
  @IsOptional()
  @IsBoolean()
  exists?: boolean;

  @IsBoolean()
  configured: boolean;

  @IsBoolean()
  driftDetected: boolean;

  @IsOptional()
  @IsString()
  url?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  publicRouteCount: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  count?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];

  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}

export class ToolStatusDto {
  @IsEnum(SeoToolName)
  tool: SeoToolName;

  @IsEnum(SeoToolStatusState)
  status: SeoToolStatusState;

  @IsOptional()
  @IsDateString()
  lastSuccessfulRunAt?: string;

  @IsOptional()
  @IsString()
  lastErrorSummary?: string;
}

export class SeoControlPlaneDto {
  @IsString()
  siteOrigin: string;

  @IsArray()
  @IsString({ each: true })
  publicRoutes: string[];

  @IsArray()
  @IsString({ each: true })
  allowedCrawlerAgents: string[];

  @IsBoolean()
  allowUnknownCrawlerAgents: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrawlerPolicyDto)
  crawlerPolicies: CrawlerPolicyDto[];

  @ValidateNested()
  @Type(() => RobotsStatusDto)
  robotsStatus: RobotsStatusDto;

  @ValidateNested()
  @Type(() => SitemapStatusDto)
  sitemapStatus: SitemapStatusDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolStatusDto)
  toolStatuses: ToolStatusDto[];

  @IsOptional()
  @IsDateString()
  lastAuditAt?: string;

  @IsArray()
  @IsString({ each: true })
  warnings: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => GithubActionsConfigDto)
  githubActions?: GithubActionsConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => JenkinsConfigDto)
  jenkins?: JenkinsConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SearchConsoleConfigDto)
  searchConsole?: SearchConsoleConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SentryConfigDto)
  sentry?: SentryConfigDto;
}

export class UpdateSeoControlPlaneDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  siteOrigin?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publicRoutes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedCrawlerAgents?: string[];

  @IsOptional()
  @IsBoolean()
  allowUnknownCrawlerAgents?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrawlerPolicyDto)
  crawlerPolicies?: CrawlerPolicyDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => GithubActionsConfigDto)
  githubActions?: GithubActionsConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => JenkinsConfigDto)
  jenkins?: JenkinsConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SearchConsoleConfigDto)
  searchConsole?: SearchConsoleConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SentryConfigDto)
  sentry?: SentryConfigDto;
}
