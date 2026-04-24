import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from '../schemas/organization.schema';

type RequestWithAuth = {
  params?: Record<string, string | undefined>;
  user?: { id?: string; role?: string };
};

@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const orgId = request.params?.orgId;
    if (!orgId) return true;

    const role = (request.user?.role ?? '').toLowerCase();
    if (role === 'admin') {
      return true;
    }
    if (role !== 'organization_leader') {
      return true;
    }

    const userId = request.user?.id;
    if (
      !userId ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(orgId)
    ) {
      throw new ForbiddenException('Invalid organization scope');
    }

    const ownsOrg = await this.organizationModel
      .exists({
        _id: new Types.ObjectId(orgId),
        leaderId: new Types.ObjectId(userId),
      })
      .exec();

    if (!ownsOrg) {
      throw new ForbiddenException(
        'Organization leaders can only access their own organization scope',
      );
    }

    return true;
  }
}
