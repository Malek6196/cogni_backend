import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Child, ChildDocument } from './schemas/child.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

export const CHILD_ACCESS_SPECIALIST_ROLES = [
  'careProvider',
  'doctor',
  'psychologist',
  'speech_therapist',
  'occupational_therapist',
  'volunteer',
  'other',
] as const;

export const CHILD_ACCESS_ALLOWED_ROLES = [
  'family',
  'organization_leader',
  ...CHILD_ACCESS_SPECIALIST_ROLES,
] as const;

type ChildAccessSpecialistRole = (typeof CHILD_ACCESS_SPECIALIST_ROLES)[number];

interface ChildAccessChildLean {
  _id?: Types.ObjectId;
  fullName?: string;
  parentId?: Types.ObjectId;
  organizationId?: Types.ObjectId;
  specialistId?: Types.ObjectId;
}

interface ChildAccessUserLean {
  _id?: Types.ObjectId;
  role?: string;
  organizationId?: Types.ObjectId;
}

export interface ChildAccessDecision {
  child: ChildAccessChildLean;
  user: ChildAccessUserLean;
  via: 'parent' | 'assigned_specialist' | 'same_organization';
}

@Injectable()
export class ChildAccessService {
  constructor(
    @InjectModel(Child.name) private readonly childModel: Model<ChildDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async assertCanAccessChild(
    childId: string,
    userId: string,
  ): Promise<ChildAccessDecision> {
    if (!Types.ObjectId.isValid(childId)) {
      throw new NotFoundException('Child not found');
    }

    const child = (await this.childModel
      .findById(childId)
      .select('fullName parentId organizationId specialistId')
      .lean()
      .exec()) as ChildAccessChildLean | null;
    if (!child) {
      throw new NotFoundException('Child not found');
    }

    const user = (await this.userModel
      .findById(userId)
      .select('role organizationId')
      .lean()
      .exec()) as ChildAccessUserLean | null;
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const role = user.role;
    const userOrgId = user.organizationId?.toString();
    const childOrgId = child.organizationId?.toString();
    const isParent = child.parentId?.toString() === userId;
    const isAssignedSpecialist = child.specialistId?.toString() === userId;
    const isSameOrganization =
      !!userOrgId && !!childOrgId && userOrgId === childOrgId;

    if (isParent) {
      return { child, user, via: 'parent' };
    }

    if (role === 'organization_leader' && isSameOrganization) {
      return { child, user, via: 'same_organization' };
    }

    if (this.isSpecialistRole(role) && isAssignedSpecialist) {
      return {
        child,
        user,
        via: 'assigned_specialist',
      };
    }

    throw new ForbiddenException('Not authorized to access this child');
  }

  private isSpecialistRole(
    role: string | undefined,
  ): role is ChildAccessSpecialistRole {
    if (!role) {
      return false;
    }
    return (CHILD_ACCESS_SPECIALIST_ROLES as readonly string[]).includes(role);
  }
}
