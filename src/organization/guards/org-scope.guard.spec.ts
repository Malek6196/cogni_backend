import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { Types } from 'mongoose';
import { OrgScopeGuard } from './org-scope.guard';

function createExecutionContext(
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('OrgScopeGuard', () => {
  let existsMock: jest.Mock;
  let guard: OrgScopeGuard;

  beforeEach(() => {
    existsMock = jest.fn();
    guard = new OrgScopeGuard({
      exists: existsMock,
    } as never);
  });

  it('allows routes without orgId param', async () => {
    const canActivate = await guard.canActivate(
      createExecutionContext({ params: {}, user: {} }),
    );
    expect(canActivate).toBe(true);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it('allows admin access for org-scoped routes', async () => {
    const canActivate = await guard.canActivate(
      createExecutionContext({
        params: { orgId: new Types.ObjectId().toString() },
        user: { id: new Types.ObjectId().toString(), role: 'admin' },
      }),
    );
    expect(canActivate).toBe(true);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it('rejects organization leader when org ownership does not match', async () => {
    existsMock.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(
      guard.canActivate(
        createExecutionContext({
          params: { orgId: new Types.ObjectId().toString() },
          user: {
            id: new Types.ObjectId().toString(),
            role: 'organization_leader',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows organization leader when ownership exists', async () => {
    existsMock.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });
    await expect(
      guard.canActivate(
        createExecutionContext({
          params: { orgId: new Types.ObjectId().toString() },
          user: {
            id: new Types.ObjectId().toString(),
            role: 'organization_leader',
          },
        }),
      ),
    ).resolves.toBe(true);
  });
});
