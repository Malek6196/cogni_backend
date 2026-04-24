import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChatbotService } from './chatbot.service';

function createLeanQuery<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('ChatbotService', () => {
  const familyUserId = new Types.ObjectId().toString();
  const otherFamilyId = new Types.ObjectId().toString();
  const adminUserId = new Types.ObjectId().toString();
  const childId = new Types.ObjectId().toString();
  const organizationId = new Types.ObjectId().toString();

  let jwtService: {
    signAsync: jest.Mock;
    verifyAsync: jest.Mock;
  };
  let userModel: {
    findById: jest.Mock;
  };
  let childModel: {
    find: jest.Mock;
  };
  let remindersService: {
    create: jest.Mock;
  };
  let childAccessService: {
    assertCanAccessChild: jest.Mock;
  };
  let service: ChatbotService;

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };
    userModel = {
      findById: jest.fn(),
    };
    childModel = {
      find: jest.fn(),
    };
    remindersService = {
      create: jest.fn(),
    };
    childAccessService = {
      assertCanAccessChild: jest.fn(),
    };

    service = new ChatbotService(
      jwtService as never,
      userModel as never,
      childModel as never,
      remindersService as never,
      childAccessService as never,
    );
  });

  it('prepares a pending reminder action for a family user', async () => {
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: familyUserId,
        fullName: 'Parent User',
        role: 'family',
      }),
    );
    childModel.find.mockReturnValue(
      createLeanQuery([
        {
          _id: new Types.ObjectId(childId),
          fullName: 'Lina',
          dateOfBirth: '2020-06-10T00:00:00.000Z',
        },
      ]),
    );
    childAccessService.assertCanAccessChild.mockResolvedValue({
      child: { fullName: 'Lina' },
      via: 'parent',
    });
    jwtService.signAsync.mockResolvedValue('confirm-token');
    jest.spyOn(service as any, 'tryProviders').mockResolvedValue({
      tool_calls: [
        {
          function: {
            name: 'prepare_routine_task',
            arguments: JSON.stringify({
              childId,
              title: 'Therapy homework',
              description: 'Practice flash cards',
              time: '09:30',
            }),
          },
        },
      ],
    });

    const response = await service.chat(
      { id: familyUserId, role: 'family' },
      'Add a reminder for Lina',
      [],
      { surface: 'mobile', route: '/family/home' },
    );

    expect(response.pendingAction).toMatchObject({
      type: 'create_task_reminder',
      confirmToken: 'confirm-token',
      preview: {
        childId,
        childName: 'Lina',
        title: 'Therapy homework',
        time: '09:30',
      },
    });
    expect(response.meta.strategy).toBe('smart_model');
    expect(childAccessService.assertCanAccessChild).toHaveBeenCalledWith(
      childId,
      familyUserId,
    );
    expect(remindersService.create).not.toHaveBeenCalled();
  });

  it('confirms reminder creation through the reminders service', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      kind: 'chatbot-confirm',
      userId: familyUserId,
      role: 'family',
      action: {
        type: 'create_task_reminder',
        childId,
        title: 'Speech practice',
        description: '10 minute routine',
        time: '18:00',
      },
    });
    childAccessService.assertCanAccessChild.mockResolvedValue({
      child: { fullName: 'Lina' },
      via: 'parent',
    });
    remindersService.create.mockResolvedValue({ id: 'reminder-1' });

    const response = await service.confirm(
      { id: familyUserId, role: 'family' },
      'confirm-token',
    );

    expect(remindersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        childId,
        title: 'Speech practice',
        description: '10 minute routine',
        times: ['18:00'],
      }),
      familyUserId,
    );
    expect(response.execution).toMatchObject({
      type: 'create_task_reminder',
      status: 'confirmed',
      entityId: 'reminder-1',
    });
  });

  it('rejects invalid or tampered confirmation tokens', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt malformed'));

    await expect(
      service.confirm({ id: familyUserId, role: 'family' }, 'bad-token'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(remindersService.create).not.toHaveBeenCalled();
  });

  it('denies cross-family reminder confirmation after revalidation', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      kind: 'chatbot-confirm',
      userId: familyUserId,
      role: 'family',
      action: {
        type: 'create_task_reminder',
        childId,
        title: 'Brush teeth',
        time: '20:00',
      },
    });
    childAccessService.assertCanAccessChild.mockRejectedValue(
      new ForbiddenException('Not authorized to access this child'),
    );

    await expect(
      service.confirm({ id: familyUserId, role: 'family' }, 'confirm-token'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(remindersService.create).not.toHaveBeenCalled();
  });

  it.each(['admin', 'organization_leader', 'careProvider'])(
    'keeps %s assistant responses read-only in v1',
    async (role) => {
      userModel.findById.mockReturnValue(
        createLeanQuery({
          _id: adminUserId,
          fullName: 'Dashboard User',
          role,
          organizationId,
        }),
      );

      const response = await service.chat(
        { id: adminUserId, role, organizationId },
        'Summarize this dashboard',
        [],
        {
          surface: 'web',
          route: '/admin/dashboard',
          uiContext: { totalUsers: 18, pendingReviews: 2 },
        },
      );

      expect(response.pendingAction).toBeUndefined();
      expect(response.reply).toContain('Dashboard User');
      expect(response.meta).toBeDefined();
    },
  );

  it('rejects a confirmation token bound to another session', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      kind: 'chatbot-confirm',
      userId: otherFamilyId,
      role: 'family',
      action: {
        type: 'create_task_reminder',
        childId,
        title: 'Homework',
        time: '19:30',
      },
    });

    await expect(
      service.confirm({ id: familyUserId, role: 'family' }, 'confirm-token'),
    ).rejects.toThrow(
      'This confirmation token is not valid for the current session',
    );
  });

  it('uses a deterministic refresh answer for dashboard refresh mode', async () => {
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: adminUserId,
        fullName: 'Dashboard User',
        role: 'admin',
        organizationId,
      }),
    );
    const providerSpy = jest.spyOn(service as any, 'tryProviders');

    const response = await service.chat(
      { id: adminUserId, role: 'admin', organizationId },
      undefined,
      [],
      {
        mode: 'refresh',
        refreshReason: 'entry',
        surface: 'web',
        route: '/admin/dashboard',
        uiContext: {
          page: 'admin-overview',
          totalUsers: 18,
          totalOrganizations: 4,
          pendingReviews: 2,
        },
      },
    );

    expect(response.meta.strategy).toBe('default');
    expect(response.meta.refreshed).toBe(true);
    expect(response.reply).toContain('18 utilisateurs');
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it('reuses cached simple answers for similar dashboard questions', async () => {
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: adminUserId,
        fullName: 'Dashboard User',
        role: 'admin',
        organizationId,
      }),
    );
    const providerSpy = jest
      .spyOn(service as any, 'tryProviders')
      .mockResolvedValue({
        content: 'Pending reviews measures items awaiting approval.',
      });

    const first = await service.chat(
      { id: adminUserId, role: 'admin', organizationId },
      'What does pending reviews mean',
      [],
      {
        surface: 'web',
        route: '/admin/dashboard',
        uiContext: { pendingReviews: 2 },
      },
    );
    const second = await service.chat(
      { id: adminUserId, role: 'admin', organizationId },
      'What does pending reviews mean',
      [],
      {
        surface: 'web',
        route: '/admin/dashboard',
        uiContext: { pendingReviews: 2 },
      },
    );

    expect(first.meta.strategy).toBe('lite_model');
    expect(second.meta.strategy).toBe('cached');
    expect(providerSpy).toHaveBeenCalledTimes(1);
  });

  it('bypasses cached answers when explicit refresh is requested', async () => {
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: adminUserId,
        fullName: 'Dashboard User',
        role: 'admin',
        organizationId,
      }),
    );
    const providerSpy = jest
      .spyOn(service as any, 'tryProviders')
      .mockResolvedValue({
        content: 'Pending reviews measures items awaiting approval.',
      });

    await service.chat(
      { id: adminUserId, role: 'admin', organizationId },
      'What does pending reviews mean',
      [],
      {
        surface: 'web',
        route: '/admin/dashboard',
        uiContext: { pendingReviews: 2 },
      },
    );

    const refreshed = await service.chat(
      { id: adminUserId, role: 'admin', organizationId },
      undefined,
      [],
      {
        surface: 'web',
        route: '/admin/dashboard',
        uiContext: {
          page: 'admin-overview',
          pendingReviews: 2,
          totalUsers: 18,
        },
        forceRefresh: true,
        mode: 'refresh',
        refreshReason: 'manual',
      },
    );

    expect(refreshed.meta.strategy).toBe('default');
    expect(refreshed.meta.refreshed).toBe(true);
    expect(refreshed.meta.cacheHit).toBe(false);
    expect(providerSpy).toHaveBeenCalledTimes(1);
  });

  it('enforces Arabic-only responses when locale is Arabic', async () => {
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: adminUserId,
        fullName: 'Arabic Admin',
        role: 'admin',
        organizationId,
      }),
    );
    jest
      .spyOn(service as any, 'tryProviders')
      .mockResolvedValue({ content: 'Dashboard summary in English only.' });

    const response = await service.chat(
      { id: adminUserId, role: 'admin', organizationId },
      'اشرح لي الأرقام بسرعة',
      [],
      {
        locale: 'ar',
        surface: 'web',
        route: '/admin/dashboard',
        uiContext: { totalUsers: 18, pendingReviews: 2 },
      },
    );

    expect(response.reply).toContain('أعتذر');
    expect(response.meta.strategy).toBe('lite_model');
  });

  it('routes short contextual family prompts to the smart model instead of a canned reply', async () => {
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: familyUserId,
        fullName: 'Parent User',
        role: 'family',
      }),
    );
    childModel.find.mockReturnValue(
      createLeanQuery([
        {
          _id: new Types.ObjectId(childId),
          fullName: 'Lina',
          dateOfBirth: '2020-06-10T00:00:00.000Z',
        },
      ]),
    );
    jest.spyOn(service as any, 'tryProviders').mockResolvedValue({
      content:
        'Commencez par revoir le dernier exercice puis ajustez le rappel du soir si nécessaire.',
    });

    const response = await service.chat(
      { id: familyUserId, role: 'family' },
      'What should I do next for Lina progress',
      [],
      {
        surface: 'mobile',
        route: '/family/progress',
      },
    );

    expect(response.meta.strategy).toBe('smart_model');
    expect(response.reply).toContain('Commencez');
  });
});
