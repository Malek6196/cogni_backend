import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChildAccessService } from './child-access.service';

function createLeanQuery<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('ChildAccessService', () => {
  const childId = new Types.ObjectId().toString();
  const parentId = new Types.ObjectId().toString();
  const assignedSpecialistId = new Types.ObjectId().toString();
  const sameOrgSpecialistId = new Types.ObjectId().toString();
  const outsiderId = new Types.ObjectId().toString();
  const organizationId = new Types.ObjectId().toString();
  const otherOrganizationId = new Types.ObjectId().toString();

  let childModel: { findById: jest.Mock };
  let userModel: { findById: jest.Mock };
  let service: ChildAccessService;

  beforeEach(() => {
    childModel = {
      findById: jest.fn(),
    };
    userModel = {
      findById: jest.fn(),
    };
    service = new ChildAccessService(childModel as never, userModel as never);
  });

  function mockChild() {
    childModel.findById.mockReturnValue(
      createLeanQuery({
        _id: new Types.ObjectId(childId),
        fullName: 'Lina',
        parentId: new Types.ObjectId(parentId),
        specialistId: new Types.ObjectId(assignedSpecialistId),
        organizationId: new Types.ObjectId(organizationId),
      }),
    );
  }

  it('allows the parent to access their child', async () => {
    mockChild();
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: new Types.ObjectId(parentId),
        role: 'family',
      }),
    );

    await expect(
      service.assertCanAccessChild(childId, parentId),
    ).resolves.toMatchObject({
      via: 'parent',
    });
  });

  it('allows an organization leader in the same organization', async () => {
    mockChild();
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: new Types.ObjectId(),
        role: 'organization_leader',
        organizationId: new Types.ObjectId(organizationId),
      }),
    );

    await expect(
      service.assertCanAccessChild(childId, new Types.ObjectId().toString()),
    ).resolves.toMatchObject({
      via: 'same_organization',
    });
  });

  it('allows a specialist from the same organization', async () => {
    mockChild();
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: new Types.ObjectId(sameOrgSpecialistId),
        role: 'careProvider',
        organizationId: new Types.ObjectId(organizationId),
      }),
    );

    await expect(
      service.assertCanAccessChild(childId, sameOrgSpecialistId),
    ).resolves.toMatchObject({
      via: 'same_organization',
    });
  });

  it('rejects an unrelated healthcare user', async () => {
    mockChild();
    userModel.findById.mockReturnValue(
      createLeanQuery({
        _id: new Types.ObjectId(outsiderId),
        role: 'careProvider',
        organizationId: new Types.ObjectId(otherOrganizationId),
      }),
    );

    await expect(
      service.assertCanAccessChild(childId, outsiderId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
