import { BadRequestException } from '@nestjs/common';
import { AdminSeoService } from './admin-seo.service';
import { SeoActionType, SeoJobStatus } from './admin-seo.constants';

function createLeanQuery<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('AdminSeoService safety checks', () => {
  let seoControlConfigModel: {
    findOne: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    create: jest.Mock;
  };
  let seoActionAuditModel: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
  };
  let seoJobRunModel: {
    findById: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
  };
  let service: AdminSeoService;

  beforeEach(() => {
    seoControlConfigModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };
    seoActionAuditModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      updateOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    seoJobRunModel = {
      findById: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };

    service = new AdminSeoService(
      seoControlConfigModel as never,
      seoActionAuditModel as never,
      seoJobRunModel as never,
      {
        getStatus: jest
          .fn()
          .mockReturnValue({ tool: 'github_actions', status: 'DISABLED' }),
        dispatchWorkflow: jest.fn(),
      } as never,
      {
        getStatus: jest
          .fn()
          .mockReturnValue({ tool: 'jenkins', status: 'DISABLED' }),
        triggerBuild: jest.fn(),
      } as never,
      {
        getStatus: jest
          .fn()
          .mockReturnValue({ tool: 'search_console', status: 'DISABLED' }),
        submitSitemap: jest.fn(),
        inspectUrl: jest.fn(),
      } as never,
    );

    seoControlConfigModel.findOne.mockReturnValue(
      createLeanQuery({
        _id: '507f1f77bcf86cd799439011',
        siteOrigin: 'https://example.com',
        publicRoutes: ['/about'],
        allowedCrawlerAgents: [],
        allowUnknownCrawlerAgents: false,
        crawlerPolicies: [
          {
            userAgent: 'Googlebot',
            allow: ['/'],
            disallow: [],
            enabled: true,
          },
        ],
        githubActions: {},
        jenkins: {},
        searchConsole: {},
        sentry: {},
        updatedAt: new Date('2026-04-11T00:00:00.000Z'),
      }),
    );
    seoActionAuditModel.findOne.mockReturnValue(createLeanQuery(null));
  });

  it('rejects private dashboard paths in control plane config', async () => {
    await expect(
      service.updateControlPlane(
        { publicRoutes: ['/admin/dashboard/analytics'] },
        { id: 'admin-1', role: 'admin' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown crawler agents unless explicitly enabled', async () => {
    await expect(
      service.updateControlPlane(
        {
          crawlerPolicies: [
            {
              userAgent: 'DuckDuckBot',
              allow: ['/'],
              disallow: [],
              enabled: true,
            },
          ],
        },
        { id: 'admin-1', role: 'admin' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the existing job result for repeated idempotency keys', async () => {
    seoActionAuditModel.findOne.mockReturnValue(
      createLeanQuery({
        _id: '507f1f77bcf86cd799439012',
        actorId: 'admin-1',
        idempotencyKey: 'same-key',
        action: SeoActionType.REGENERATE_SITEMAP,
        status: SeoJobStatus.PENDING,
        correlationId: 'corr-1',
        startedAt: new Date('2026-04-11T00:00:00.000Z'),
        jobId: '507f1f77bcf86cd799439013',
      }),
    );
    seoJobRunModel.findById.mockReturnValue(
      createLeanQuery({
        _id: '507f1f77bcf86cd799439013',
        action: SeoActionType.REGENERATE_SITEMAP,
        status: SeoJobStatus.PENDING,
        summary: 'Queued for asynchronous execution.',
        actorId: 'admin-1',
        role: 'admin',
        idempotencyKey: 'same-key',
        correlationId: 'corr-1',
        startedAt: new Date('2026-04-11T00:00:00.000Z'),
        createdAt: new Date('2026-04-11T00:00:00.000Z'),
      }),
    );

    const result = await service.queueAction(
      {
        action: SeoActionType.REGENERATE_SITEMAP,
        idempotencyKey: 'same-key',
      },
      { id: 'admin-1', role: 'admin' },
    );

    expect(result.jobId).toBe('507f1f77bcf86cd799439013');
    expect(seoJobRunModel.create).not.toHaveBeenCalled();
  });

  it('handles concurrent duplicate idempotency keys without creating a second job', async () => {
    const duplicateError = Object.assign(new Error('duplicate key'), {
      code: 11000,
    });

    seoActionAuditModel.findOne
      .mockReturnValueOnce(createLeanQuery(null))
      .mockReturnValueOnce(
        createLeanQuery({
          _id: '507f1f77bcf86cd799439022',
          actorId: 'admin-1',
          idempotencyKey: 'race-key',
          action: SeoActionType.REGENERATE_SITEMAP,
          status: SeoJobStatus.PENDING,
          correlationId: 'corr-race',
          startedAt: new Date('2026-04-11T00:00:00.000Z'),
          jobId: '507f1f77bcf86cd799439023',
        }),
      );

    seoJobRunModel.create.mockRejectedValue(duplicateError);
    seoJobRunModel.findOne.mockReturnValue(
      createLeanQuery({
        _id: '507f1f77bcf86cd799439023',
        action: SeoActionType.REGENERATE_SITEMAP,
        status: SeoJobStatus.PENDING,
        summary: 'Queued for asynchronous execution.',
        actorId: 'admin-1',
        role: 'admin',
        idempotencyKey: 'race-key',
        correlationId: 'corr-race',
        startedAt: new Date('2026-04-11T00:00:00.000Z'),
        createdAt: new Date('2026-04-11T00:00:00.000Z'),
      }),
    );
    seoJobRunModel.findById.mockReturnValue(
      createLeanQuery({
        _id: '507f1f77bcf86cd799439023',
        action: SeoActionType.REGENERATE_SITEMAP,
        status: SeoJobStatus.PENDING,
        summary: 'Queued for asynchronous execution.',
        actorId: 'admin-1',
        role: 'admin',
        idempotencyKey: 'race-key',
        correlationId: 'corr-race',
        startedAt: new Date('2026-04-11T00:00:00.000Z'),
        createdAt: new Date('2026-04-11T00:00:00.000Z'),
      }),
    );

    const result = await service.queueAction(
      {
        action: SeoActionType.REGENERATE_SITEMAP,
        idempotencyKey: 'race-key',
      },
      { id: 'admin-1', role: 'admin' },
    );

    expect(result.jobId).toBe('507f1f77bcf86cd799439023');
    expect(seoActionAuditModel.create).not.toHaveBeenCalled();
  });
});
