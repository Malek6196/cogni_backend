import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import {
  DEFAULT_CRAWLER_AGENTS,
  DEFAULT_PUBLIC_ROUTES,
  PRIVATE_PATH_PREFIXES,
  SeoActionType,
  SeoJobStatus,
  SeoToolName,
  SeoToolStatusState,
} from './admin-seo.constants';
import {
  SeoControlPlaneDto,
  ToolStatusDto,
  UpdateSeoControlPlaneDto,
} from './dto/seo-control-plane.dto';
import {
  SeoActionHistoryItemDto,
  SeoActionHistoryQueryDto,
  SeoActionHistoryResponseDto,
  SeoActionRequestDto,
  SeoActionResultDto,
  SeoToolStatusResponseDto,
} from './dto/seo-action.dto';
import {
  SeoControlConfig,
  SeoControlConfigDocument,
  GithubActionsConfig,
  JenkinsConfig,
  SearchConsoleConfig,
  SentryConfig,
} from './schemas/seo-control-config.schema';
import {
  SeoActionAudit,
  SeoActionAuditDocument,
} from './schemas/seo-action-audit.schema';
import { SeoJobRun, SeoJobRunDocument } from './schemas/seo-job-run.schema';
import {
  GithubActionsConnector,
  SeoToolStatus,
} from './connectors/github-actions.connector';
import { JenkinsConnector } from './connectors/jenkins.connector';
import { SearchConsoleConnector } from './connectors/search-console.connector';

interface AdminActor {
  id: string;
  role: string;
}

interface LeanConfig {
  _id?: Types.ObjectId;
  siteOrigin: string;
  publicRoutes: string[];
  allowedCrawlerAgents: string[];
  allowUnknownCrawlerAgents: boolean;
  crawlerPolicies: Array<{
    userAgent: string;
    allow: string[];
    disallow: string[];
    crawlDelay?: number | null;
    enabled: boolean;
  }>;
  githubActions?: Partial<GithubActionsConfig>;
  jenkins?: Partial<JenkinsConfig>;
  searchConsole?: Partial<SearchConsoleConfig>;
  sentry?: Partial<SentryConfig>;
  createdAt?: Date;
  updatedAt?: Date;
}

interface LeanAudit {
  _id: Types.ObjectId;
  action: SeoActionType;
  target?: string | null;
  tool?: SeoToolName | null;
  status: SeoJobStatus;
  correlationId: string;
  startedAt: Date;
  finishedAt?: Date | null;
  summary?: string | null;
  errorCode?: string | null;
  jobId: string;
  actorId: string;
  idempotencyKey: string;
}

interface LeanJob {
  _id: Types.ObjectId;
  action: SeoActionType;
  tool?: SeoToolName | null;
  target?: string | null;
  status: SeoJobStatus;
  summary: string;
  errorCode?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  actorId: string;
  role: string;
  idempotencyKey: string;
  correlationId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class AdminSeoService {
  private readonly logger = new Logger(AdminSeoService.name);
  private processingQueue = false;

  constructor(
    @InjectModel(SeoControlConfig.name)
    private readonly seoControlConfigModel: Model<SeoControlConfigDocument>,
    @InjectModel(SeoActionAudit.name)
    private readonly seoActionAuditModel: Model<SeoActionAuditDocument>,
    @InjectModel(SeoJobRun.name)
    private readonly seoJobRunModel: Model<SeoJobRunDocument>,
    private readonly githubActionsConnector: GithubActionsConnector,
    private readonly jenkinsConnector: JenkinsConnector,
    private readonly searchConsoleConnector: SearchConsoleConnector,
  ) {}

  async getControlPlane(): Promise<SeoControlPlaneDto> {
    const config = await this.ensureConfig();
    return this.buildControlPlaneDto(config);
  }

  async updateControlPlane(
    updateDto: UpdateSeoControlPlaneDto,
    actor: AdminActor,
  ): Promise<SeoControlPlaneDto> {
    const current = await this.ensureConfig();
    const nextConfig = this.mergeConfig(current, updateDto);

    await this.seoControlConfigModel
      .findByIdAndUpdate(current._id, nextConfig, {
        new: true,
        runValidators: true,
      })
      .exec();

    this.logger.log(`Admin SEO config updated by admin ${actor.id}`);
    return this.buildControlPlaneDto(nextConfig);
  }

  async queueAction(
    actionDto: SeoActionRequestDto,
    actor: AdminActor,
  ): Promise<SeoActionResultDto> {
    const config = await this.ensureConfig();
    const action = actionDto.action;
    const targetPath = actionDto.targetPath
      ? this.normalizePublicPath(actionDto.targetPath)
      : undefined;

    if (targetPath) {
      this.assertPublicPath(targetPath);
    }

    if (
      (action === SeoActionType.INSPECT_URL_COVERAGE ||
        action === SeoActionType.REQUEST_INDEXING) &&
      !targetPath
    ) {
      throw new BadRequestException(
        `targetPath is required for ${action} actions.`,
      );
    }

    const correlationId = this.buildCorrelationId(
      actor.id,
      actionDto.idempotencyKey,
    );
    const existingAudit = await this.seoActionAuditModel
      .findOne({ actorId: actor.id, idempotencyKey: actionDto.idempotencyKey })
      .lean<LeanAudit>()
      .exec();

    if (existingAudit) {
      const existingJob = await this.seoJobRunModel
        .findById(existingAudit.jobId)
        .lean<LeanJob>()
        .exec();
      if (!existingJob) {
        throw new NotFoundException('Existing SEO job could not be loaded.');
      }
      return this.toActionResult(existingJob);
    }

    const resolvedTool = this.resolveToolForAction(actionDto, config);
    const now = new Date();
    let job: { _id: Types.ObjectId };
    try {
      job = await this.seoJobRunModel.create({
        action,
        tool: resolvedTool,
        target: targetPath ?? null,
        actorId: actor.id,
        role: actor.role,
        idempotencyKey: actionDto.idempotencyKey,
        correlationId,
        status: SeoJobStatus.PENDING,
        summary: 'Queued for asynchronous execution.',
        startedAt: now,
      });

      await this.seoActionAuditModel.create({
        actorId: actor.id,
        role: actor.role,
        action,
        target: targetPath ?? null,
        tool: resolvedTool,
        status: SeoJobStatus.PENDING,
        idempotencyKey: actionDto.idempotencyKey,
        correlationId,
        jobId: job._id.toString(),
        summary: 'Queued for asynchronous execution.',
        startedAt: now,
      });
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }

      // Concurrent requests with the same idempotency key should converge on a single job result.
      const [duplicateAudit, duplicateJobByCorrelation] = await Promise.all([
        this.seoActionAuditModel
          .findOne({
            actorId: actor.id,
            idempotencyKey: actionDto.idempotencyKey,
          })
          .lean<LeanAudit>()
          .exec(),
        this.seoJobRunModel.findOne({ correlationId }).lean<LeanJob>().exec(),
      ]);

      const duplicateJob = duplicateAudit
        ? await this.seoJobRunModel
            .findById(duplicateAudit.jobId)
            .lean<LeanJob>()
            .exec()
        : duplicateJobByCorrelation;

      if (duplicateJob) {
        return this.toActionResult(duplicateJob);
      }

      throw new BadRequestException(
        'Duplicate idempotency key detected but no existing SEO job was found.',
      );
    }

    this.kickQueue();

    return {
      jobId: job._id.toString(),
      status: SeoJobStatus.PENDING,
      startedAt: now.toISOString(),
      summary: 'Queued for asynchronous execution.',
    };
  }

  async getActionHistory(
    query: SeoActionHistoryQueryDto,
  ): Promise<SeoActionHistoryResponseDto> {
    const limit = Math.min(query.limit ?? 50, 100);
    const filter: { _id?: { $lt: Types.ObjectId } } = {};

    if (query.cursor) {
      if (!Types.ObjectId.isValid(query.cursor)) {
        throw new BadRequestException('Invalid cursor.');
      }
      filter._id = { $lt: new Types.ObjectId(query.cursor) };
    }

    const audits = await this.seoActionAuditModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean<LeanAudit[]>()
      .exec();

    const hasNextPage = audits.length > limit;
    const sliced = hasNextPage ? audits.slice(0, limit) : audits;

    return {
      items: sliced.map((item) => this.toHistoryItem(item)),
      nextCursor: hasNextPage
        ? sliced[sliced.length - 1]._id.toString()
        : undefined,
    };
  }

  async getToolStatuses(): Promise<SeoToolStatusResponseDto> {
    const config = await this.ensureConfig();
    const toolStatuses = await this.buildToolStatuses(config);
    return { toolStatuses };
  }

  @Interval(15000)
  async pollPendingJobs(): Promise<void> {
    await this.processPendingJobs();
  }

  kickQueue(): void {
    setTimeout(() => {
      void this.processPendingJobs();
    }, 0);
  }

  private async processPendingJobs(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;
    try {
      while (true) {
        const job = await this.seoJobRunModel
          .findOneAndUpdate(
            { status: SeoJobStatus.PENDING },
            {
              $set: {
                status: SeoJobStatus.RUNNING,
                summary: 'Running asynchronous SEO action.',
                startedAt: new Date(),
              },
            },
            { new: true, sort: { createdAt: 1 } },
          )
          .lean<LeanJob>()
          .exec();

        if (!job) {
          break;
        }

        await this.seoActionAuditModel
          .updateOne(
            { correlationId: job.correlationId },
            {
              $set: {
                status: SeoJobStatus.RUNNING,
                summary: 'Running asynchronous SEO action.',
                startedAt: job.startedAt ?? new Date(),
              },
            },
          )
          .exec();

        await this.executeJob(job);
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private async executeJob(job: LeanJob): Promise<void> {
    const config = await this.ensureConfig();
    const targetUrl = this.buildTargetUrl(
      config.siteOrigin,
      job.target ?? undefined,
    );
    let result: { success: boolean; summary: string; errorCode?: string };

    switch (job.action) {
      case SeoActionType.REGENERATE_SITEMAP:
        result = {
          success: true,
          summary: `Sitemap regeneration queued for ${config.publicRoutes.length} public routes.`,
        };
        break;
      case SeoActionType.VALIDATE_ROBOTS_RULES:
        result = this.validateRobotsRules(config);
        break;
      case SeoActionType.SUBMIT_SITEMAP:
        result = await this.searchConsoleConnector.submitSitemap(
          config.searchConsole?.sitemapUrl ||
            `${config.siteOrigin.replace(/\/$/, '')}/sitemap.xml`,
          config.searchConsole,
        );
        break;
      case SeoActionType.INSPECT_URL_COVERAGE:
        if (!job.target || !targetUrl) {
          result = {
            success: false,
            summary: 'Target path is required for URL inspection.',
            errorCode: 'TARGET_PATH_REQUIRED',
          };
          break;
        }
        result = await this.searchConsoleConnector.inspectUrl(
          targetUrl,
          config.searchConsole,
        );
        break;
      case SeoActionType.REQUEST_INDEXING:
        result = {
          success: false,
          summary:
            'Direct indexing requests are not supported for this URL type; submit sitemap and use URL inspection as the supported fallback.',
          errorCode: 'INDEXING_API_UNSUPPORTED_FOR_URL',
        };
        break;
      case SeoActionType.TRIGGER_LIGHTHOUSE_SCAN:
        result = await this.triggerAutomationJob(
          job.tool ?? SeoToolName.GITHUB_ACTIONS,
          'lighthouse',
          targetUrl,
          config,
        );
        break;
      case SeoActionType.TRIGGER_ZAP_SCAN:
        result = await this.triggerAutomationJob(
          job.tool ?? SeoToolName.GITHUB_ACTIONS,
          'zap',
          targetUrl,
          config,
        );
        break;
      case SeoActionType.TRIGGER_JENKINS_BUILD:
        result = await this.jenkinsConnector.triggerBuild(
          {
            baseUrl: config.jenkins?.baseUrl ?? '',
            jobName: config.jenkins?.jobName ?? '',
            targetUrl: targetUrl ?? config.siteOrigin,
          },
          config.jenkins,
        );
        break;
      default:
        result = {
          success: false,
          summary: 'Unsupported SEO action.',
          errorCode: 'UNSUPPORTED_ACTION',
        };
        break;
    }

    const finishedAt = new Date();
    const nextStatus = result.success
      ? SeoJobStatus.COMPLETED
      : SeoJobStatus.FAILED;

    await this.seoJobRunModel
      .updateOne(
        { _id: job._id },
        {
          $set: {
            status: nextStatus,
            summary: result.summary,
            errorCode: result.errorCode ?? null,
            finishedAt,
          },
        },
      )
      .exec();

    await this.seoActionAuditModel
      .updateOne(
        { correlationId: job.correlationId },
        {
          $set: {
            status: nextStatus,
            summary: result.summary,
            errorCode: result.errorCode ?? null,
            finishedAt,
          },
        },
      )
      .exec();
  }

  private async triggerAutomationJob(
    tool: SeoToolName,
    workflowKind: 'lighthouse' | 'zap',
    targetUrl: string | undefined,
    config: LeanConfig,
  ): Promise<{ success: boolean; summary: string; errorCode?: string }> {
    if (!targetUrl) {
      return {
        success: false,
        summary: 'A target URL is required to run external automation.',
        errorCode: 'TARGET_URL_REQUIRED',
      };
    }

    if (tool === SeoToolName.JENKINS) {
      return this.jenkinsConnector.triggerBuild(
        {
          baseUrl: config.jenkins?.baseUrl ?? '',
          jobName: config.jenkins?.jobName ?? '',
          targetUrl,
        },
        config.jenkins,
      );
    }

    if (tool !== SeoToolName.GITHUB_ACTIONS) {
      return {
        success: false,
        summary: 'Selected automation tool is not supported for this action.',
        errorCode: 'UNSUPPORTED_TOOL',
      };
    }

    const workflowId =
      workflowKind === 'lighthouse'
        ? config.githubActions?.lighthouseWorkflowId
        : config.githubActions?.zapWorkflowId;

    if (!workflowId || !config.githubActions?.repository) {
      return {
        success: false,
        summary: 'GitHub Actions workflow configuration is incomplete.',
        errorCode: 'GITHUB_WORKFLOW_MISSING',
      };
    }

    return this.githubActionsConnector.dispatchWorkflow(
      {
        workflowId,
        repository: config.githubActions.repository,
        branch: config.githubActions.branch || 'main',
        inputs: { target_url: targetUrl },
      },
      config.githubActions,
    );
  }

  private validateRobotsRules(config: LeanConfig): {
    success: boolean;
    summary: string;
    errorCode?: string;
  } {
    const violatingPolicies = config.crawlerPolicies.filter((policy) =>
      policy.allow.some((path) => this.isPrivatePath(path)),
    );

    if (violatingPolicies.length > 0) {
      return {
        success: false,
        summary:
          'Robots validation failed because private dashboard paths were allowed.',
        errorCode: 'ROBOTS_PRIVATE_PATH_ALLOWED',
      };
    }

    return {
      success: true,
      summary: 'Robots rules validated successfully.',
    };
  }

  private async ensureConfig(): Promise<LeanConfig> {
    const existing = await this.seoControlConfigModel
      .findOne()
      .sort({ createdAt: 1 })
      .lean<LeanConfig>()
      .exec();

    if (existing) {
      return this.normalizeConfig(existing);
    }

    const created = await this.seoControlConfigModel.create({
      siteOrigin:
        process.env.PUBLIC_SITE_ORIGIN?.trim() || 'https://cognicare.app',
      publicRoutes: [...DEFAULT_PUBLIC_ROUTES],
      allowedCrawlerAgents: [],
      allowUnknownCrawlerAgents: false,
      crawlerPolicies: DEFAULT_CRAWLER_AGENTS.map((userAgent) => ({
        userAgent,
        allow: ['/'],
        disallow: [],
        enabled: true,
      })),
    });

    return this.normalizeConfig(
      (await this.seoControlConfigModel
        .findById(created._id)
        .lean<LeanConfig>()
        .exec()) as LeanConfig,
    );
  }

  private normalizeConfig(config: LeanConfig): LeanConfig {
    return {
      ...config,
      siteOrigin: config.siteOrigin ?? '',
      publicRoutes: [
        ...new Set(
          (config.publicRoutes ?? []).map((path) =>
            this.normalizePublicPath(path),
          ),
        ),
      ],
      allowedCrawlerAgents: [
        ...new Set(
          (config.allowedCrawlerAgents ?? [])
            .map((agent) => agent.trim())
            .filter(Boolean),
        ),
      ],
      allowUnknownCrawlerAgents: Boolean(config.allowUnknownCrawlerAgents),
      crawlerPolicies:
        config.crawlerPolicies?.map((policy) => ({
          userAgent: policy.userAgent.trim(),
          allow: (policy.allow ?? []).map((path) =>
            this.normalizePublicPath(path),
          ),
          disallow: (policy.disallow ?? []).map((path) =>
            this.normalizePublicPath(path),
          ),
          crawlDelay: policy.crawlDelay ?? undefined,
          enabled: policy.enabled !== false,
        })) ??
        DEFAULT_CRAWLER_AGENTS.map((userAgent) => ({
          userAgent,
          allow: ['/'],
          disallow: [],
          enabled: true,
        })),
      githubActions: config.githubActions,
      jenkins: config.jenkins,
      searchConsole: config.searchConsole,
      sentry: config.sentry,
      _id: config._id,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private mergeConfig(
    current: LeanConfig,
    updateDto: UpdateSeoControlPlaneDto,
  ): LeanConfig {
    const next: LeanConfig = {
      ...current,
      siteOrigin: updateDto.siteOrigin ?? current.siteOrigin,
      publicRoutes: updateDto.publicRoutes
        ? [
            ...new Set(
              updateDto.publicRoutes.map((path) =>
                this.normalizePublicPath(path),
              ),
            ),
          ]
        : current.publicRoutes,
      allowedCrawlerAgents: updateDto.allowedCrawlerAgents
        ? [
            ...new Set(
              updateDto.allowedCrawlerAgents
                .map((agent) => agent.trim())
                .filter(Boolean),
            ),
          ]
        : current.allowedCrawlerAgents,
      allowUnknownCrawlerAgents:
        updateDto.allowUnknownCrawlerAgents ??
        current.allowUnknownCrawlerAgents,
      crawlerPolicies: updateDto.crawlerPolicies
        ? updateDto.crawlerPolicies.map((policy) => ({
            userAgent: policy.userAgent.trim(),
            allow: policy.allow.map((path) => this.normalizePublicPath(path)),
            disallow: policy.disallow.map((path) =>
              this.normalizePublicPath(path),
            ),
            crawlDelay: policy.crawlDelay,
            enabled: policy.enabled,
          }))
        : current.crawlerPolicies,
      githubActions: {
        ...(current.githubActions ?? {}),
        ...(updateDto.githubActions ?? {}),
      },
      jenkins: {
        ...(current.jenkins ?? {}),
        ...(updateDto.jenkins ?? {}),
      },
      searchConsole: {
        ...(current.searchConsole ?? {}),
        ...(updateDto.searchConsole ?? {}),
      },
      sentry: {
        ...(current.sentry ?? {}),
        ...(updateDto.sentry ?? {}),
      },
    };

    next.publicRoutes.forEach((path) => this.assertPublicPath(path));
    next.crawlerPolicies.forEach((policy) => {
      policy.allow.forEach((path) => this.assertPublicPath(path));
      policy.disallow.forEach((path) => this.assertNormalizedPath(path));
    });
    this.assertCrawlerPolicies(next.crawlerPolicies, next);
    this.assertSecretReference(
      next.githubActions?.tokenSecretRef,
      'githubActions.tokenSecretRef',
    );
    this.assertSecretReference(
      next.jenkins?.usernameSecretRef,
      'jenkins.usernameSecretRef',
    );
    this.assertSecretReference(
      next.jenkins?.apiTokenSecretRef,
      'jenkins.apiTokenSecretRef',
    );
    this.assertSecretReference(
      next.searchConsole?.credentialsSecretRef,
      'searchConsole.credentialsSecretRef',
    );
    this.assertSecretReference(
      next.sentry?.dsnSecretRef,
      'sentry.dsnSecretRef',
    );

    return next;
  }

  private assertCrawlerPolicies(
    policies: LeanConfig['crawlerPolicies'],
    config: Pick<
      LeanConfig,
      'allowedCrawlerAgents' | 'allowUnknownCrawlerAgents'
    >,
  ): void {
    const allowedAgents = new Set([
      ...DEFAULT_CRAWLER_AGENTS,
      ...(config.allowedCrawlerAgents ?? []),
    ]);

    for (const policy of policies) {
      if (!policy.userAgent) {
        throw new BadRequestException(
          'Crawler policies must include a userAgent.',
        );
      }

      if (
        !config.allowUnknownCrawlerAgents &&
        !allowedAgents.has(policy.userAgent)
      ) {
        throw new BadRequestException(
          `Unknown crawler agent rejected: ${policy.userAgent}.`,
        );
      }
    }
  }

  private assertSecretReference(
    value: string | undefined,
    fieldName: string,
  ): void {
    if (!value) {
      return;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      throw new BadRequestException(
        `${fieldName} must be an environment variable reference, not a raw secret.`,
      );
    }
  }

  private assertPublicPath(path: string): void {
    this.assertNormalizedPath(path);
    if (this.isPrivatePath(path)) {
      throw new BadRequestException(`Private paths are not allowed: ${path}`);
    }
  }

  private assertNormalizedPath(path: string): void {
    if (!path.startsWith('/')) {
      throw new BadRequestException(`Paths must start with '/': ${path}`);
    }
  }

  private normalizePublicPath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) {
      throw new BadRequestException('Path values cannot be empty.');
    }

    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (normalized.length > 1 && normalized.endsWith('/')) {
      return normalized.replace(/\/+$/, '');
    }
    return normalized;
  }

  private isPrivatePath(path: string): boolean {
    return PRIVATE_PATH_PREFIXES.some(
      (privatePrefix) =>
        path === privatePrefix || path.startsWith(`${privatePrefix}/`),
    );
  }

  private buildCorrelationId(actorId: string, idempotencyKey: string): string {
    return createHash('sha256')
      .update(`${actorId}:${idempotencyKey}`)
      .digest('hex');
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    return (error as { code?: number }).code === 11000;
  }

  private resolveToolForAction(
    actionDto: SeoActionRequestDto,
    config: LeanConfig,
  ): SeoToolName | null {
    switch (actionDto.action) {
      case SeoActionType.SUBMIT_SITEMAP:
      case SeoActionType.INSPECT_URL_COVERAGE:
      case SeoActionType.REQUEST_INDEXING:
        return SeoToolName.SEARCH_CONSOLE;
      case SeoActionType.TRIGGER_JENKINS_BUILD:
        return SeoToolName.JENKINS;
      case SeoActionType.TRIGGER_LIGHTHOUSE_SCAN:
      case SeoActionType.TRIGGER_ZAP_SCAN:
        if (
          actionDto.tool &&
          actionDto.tool !== SeoToolName.GITHUB_ACTIONS &&
          actionDto.tool !== SeoToolName.JENKINS
        ) {
          throw new BadRequestException(
            'Only GitHub Actions or Jenkins can run scan actions.',
          );
        }
        if (actionDto.tool === SeoToolName.JENKINS) {
          return SeoToolName.JENKINS;
        }
        if (config.githubActions?.repository) {
          return SeoToolName.GITHUB_ACTIONS;
        }
        return SeoToolName.JENKINS;
      default:
        return actionDto.tool ?? null;
    }
  }

  private async buildControlPlaneDto(
    config: LeanConfig,
  ): Promise<SeoControlPlaneDto> {
    const toolStatuses = await this.buildToolStatuses(config);
    const lastAudit = await this.seoActionAuditModel
      .findOne()
      .sort({ startedAt: -1 })
      .lean<LeanAudit>()
      .exec();

    const warnings: string[] = [];
    if (!config.siteOrigin) {
      warnings.push('Site origin is not configured.');
    }
    if (config.publicRoutes.length === 0) {
      warnings.push('Public route allowlist is empty.');
    }

    const privateRouteViolations = config.publicRoutes.filter((path) =>
      this.isPrivatePath(path),
    );
    if (privateRouteViolations.length > 0) {
      warnings.push('Public route allowlist includes private dashboard paths.');
    }

    const robotsWarnings: string[] = [];
    if (config.crawlerPolicies.some((policy) => policy.allow.length === 0)) {
      robotsWarnings.push('At least one crawler policy has no allowed paths.');
    }
    if (
      config.crawlerPolicies.some((policy) =>
        policy.allow.some((path) => this.isPrivatePath(path)),
      )
    ) {
      robotsWarnings.push('Robots rules allow a private dashboard path.');
    }

    const sitemapWarnings: string[] = [];
    if (!config.siteOrigin) {
      sitemapWarnings.push('Site origin is missing.');
    }
    if (privateRouteViolations.length > 0) {
      sitemapWarnings.push(
        'Public route allowlist contains private dashboard paths.',
      );
    }

    return {
      siteOrigin: config.siteOrigin,
      publicRoutes: config.publicRoutes,
      allowedCrawlerAgents: config.allowedCrawlerAgents,
      allowUnknownCrawlerAgents: config.allowUnknownCrawlerAgents,
      crawlerPolicies: config.crawlerPolicies.map((policy) => ({
        ...policy,
        crawlDelay: policy.crawlDelay ?? undefined,
      })),
      robotsStatus: {
        exists: true,
        managed: config.crawlerPolicies.length > 0,
        driftDetected: config.crawlerPolicies.some((policy) =>
          policy.allow.some((path) => this.isPrivatePath(path)),
        ),
        url: '/robots.txt',
        blockedPrivatePrefixes: [...PRIVATE_PATH_PREFIXES],
        paths: [
          ...new Set(config.crawlerPolicies.flatMap((policy) => policy.allow)),
        ],
        warnings: robotsWarnings,
        updatedAt: config.updatedAt?.toISOString(),
      },
      sitemapStatus: {
        exists: Boolean(config.siteOrigin),
        configured: Boolean(config.siteOrigin),
        driftDetected: privateRouteViolations.length > 0,
        url: '/sitemap.xml',
        publicRouteCount: config.publicRoutes.length,
        count: config.publicRoutes.length,
        paths: config.publicRoutes,
        warnings: sitemapWarnings,
        updatedAt: config.updatedAt?.toISOString(),
      },
      toolStatuses,
      lastAuditAt: lastAudit?.startedAt?.toISOString(),
      warnings,
      githubActions: config.githubActions,
      jenkins: config.jenkins,
      searchConsole: config.searchConsole,
      sentry: config.sentry,
    };
  }

  private async buildToolStatuses(
    config: LeanConfig,
  ): Promise<ToolStatusDto[]> {
    const baseStatuses: SeoToolStatus[] = [
      this.githubActionsConnector.getStatus(config.githubActions),
      this.jenkinsConnector.getStatus(config.jenkins),
      this.searchConsoleConnector.getStatus(config.searchConsole),
      this.getSentryStatus(config.sentry),
      await this.getSyntheticScanStatus(
        SeoToolName.LIGHTHOUSE,
        SeoActionType.TRIGGER_LIGHTHOUSE_SCAN,
      ),
      await this.getSyntheticScanStatus(
        SeoToolName.ZAP,
        SeoActionType.TRIGGER_ZAP_SCAN,
      ),
    ];

    return Promise.all(
      baseStatuses.map(async (status) => {
        const [lastSuccess, lastFailure] = await Promise.all([
          this.seoJobRunModel
            .findOne({ tool: status.tool, status: SeoJobStatus.COMPLETED })
            .sort({ finishedAt: -1 })
            .lean<LeanJob>()
            .exec(),
          this.seoJobRunModel
            .findOne({ tool: status.tool, status: SeoJobStatus.FAILED })
            .sort({ finishedAt: -1 })
            .lean<LeanJob>()
            .exec(),
        ]);

        return {
          ...status,
          lastSuccessfulRunAt: lastSuccess?.finishedAt?.toISOString(),
          lastErrorSummary:
            status.lastErrorSummary ?? lastFailure?.summary ?? undefined,
        };
      }),
    );
  }

  private async getSyntheticScanStatus(
    tool: SeoToolName.LIGHTHOUSE | SeoToolName.ZAP,
    action: SeoActionType,
  ): Promise<SeoToolStatus> {
    const latest = await this.seoJobRunModel
      .findOne({ action })
      .sort({ finishedAt: -1, startedAt: -1, createdAt: -1 })
      .lean<LeanJob>()
      .exec();

    if (!latest) {
      return {
        tool,
        status: SeoToolStatusState.DISABLED,
        lastErrorSummary: 'No scan has been triggered yet.',
      };
    }

    if (latest.status === SeoJobStatus.COMPLETED) {
      return {
        tool,
        status: SeoToolStatusState.CONNECTED,
        lastSuccessfulRunAt: (
          latest.finishedAt ?? latest.startedAt
        )?.toISOString(),
      };
    }

    if (latest.status === SeoJobStatus.FAILED) {
      return {
        tool,
        status: SeoToolStatusState.ERROR,
        lastErrorSummary: latest.summary || 'Latest scan failed.',
      };
    }

    return {
      tool,
      status: SeoToolStatusState.DEGRADED,
      lastErrorSummary: latest.summary || 'Scan is queued or running.',
    };
  }

  private getSentryStatus(config?: Partial<SentryConfig>): SeoToolStatus {
    const hasAnyConfig = Boolean(config?.dsnSecretRef);
    if (!hasAnyConfig) {
      return { tool: SeoToolName.SENTRY, status: SeoToolStatusState.DISABLED };
    }

    if (!config?.dsnSecretRef) {
      return {
        tool: SeoToolName.SENTRY,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary: 'Sentry DSN reference is missing.',
      };
    }

    if (!process.env[config.dsnSecretRef]) {
      return {
        tool: SeoToolName.SENTRY,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary:
          'Referenced Sentry DSN is not available in the runtime environment.',
      };
    }

    return { tool: SeoToolName.SENTRY, status: SeoToolStatusState.CONNECTED };
  }

  private buildTargetUrl(
    siteOrigin: string,
    targetPath?: string,
  ): string | undefined {
    if (!siteOrigin) {
      return undefined;
    }

    const normalizedOrigin = siteOrigin.replace(/\/$/, '');
    if (!targetPath) {
      return normalizedOrigin;
    }

    return `${normalizedOrigin}${targetPath}`;
  }

  private toActionResult(job: LeanJob): SeoActionResultDto {
    return {
      jobId: job._id.toString(),
      status: job.status,
      startedAt: (job.startedAt ?? job.createdAt ?? new Date()).toISOString(),
      finishedAt: job.finishedAt?.toISOString(),
      summary: job.summary,
      errorCode: job.errorCode ?? undefined,
    };
  }

  private toHistoryItem(item: LeanAudit): SeoActionHistoryItemDto {
    return {
      id: item._id.toString(),
      action: item.action,
      target: item.target ?? undefined,
      tool: item.tool ?? undefined,
      status: item.status,
      correlationId: item.correlationId,
      startedAt: item.startedAt.toISOString(),
      finishedAt: item.finishedAt?.toISOString(),
      summary: item.summary ?? undefined,
      errorCode: item.errorCode ?? undefined,
    };
  }
}
