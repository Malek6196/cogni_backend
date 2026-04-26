import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Child, ChildDocument } from './schemas/child.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organization/schemas/organization.schema';
import { OrganizationService } from '../organization/organization.service';
import { AddChildDto } from './dto/add-child.dto';
import { CreateFamilyDto } from '../organization/dto/create-family.dto';
import { SpecializedPlansService } from '../specialized-plans/specialized-plans.service';

interface UserLean {
  _id?: Types.ObjectId;
  role?: string;
  organizationId?: Types.ObjectId;
}

interface OrgLean {
  _id?: Types.ObjectId;
}

/** Matches Mongoose lean() result: dateOfBirth is Date in DB. */
interface ChildLean {
  _id?: Types.ObjectId;
  fullName?: string;
  dateOfBirth?: Date | string;
  gender?: string;
  diagnosis?: string;
  medicalHistory?: string;
  allergies?: string;
  medications?: string;
  notes?: string;
  parentId?: Types.ObjectId;
  organizationId?: Types.ObjectId;
}

export interface SpecialistPatientSummaryResponse {
  id: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  diagnosis: string | undefined;
  progressPercent: number;
  activePlansCount: number;
  lastUpdatedAt: string | undefined;
}

@Injectable()
export class ChildrenService {
  constructor(
    @InjectModel(Child.name) private childModel: Model<ChildDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Organization.name)
    private organizationModel: Model<OrganizationDocument>,
    private organizationService: OrganizationService,
    private specializedPlansService: SpecializedPlansService,
  ) {}

  /**
   * Get children for a family. Secured: only the family (parent) or org leader can list.
   */
  async findByFamilyId(familyId: string, requesterId: string) {
    const family = (await this.userModel
      .findById(familyId)
      .lean()
      .exec()) as UserLean | null;
    if (!family) throw new NotFoundException('Family not found');
    if (family.role !== 'family') {
      throw new BadRequestException('User is not a family');
    }
    const familyIdStr = family._id?.toString();
    if (familyIdStr !== requesterId) {
      const org = (await this.organizationModel
        .findOne({ leaderId: new Types.ObjectId(requesterId) })
        .lean()
        .exec()) as OrgLean | null;
      if (!org) {
        throw new ForbiddenException(
          'Not allowed to list this family children',
        );
      }
      if (family.organizationId?.toString() !== org._id?.toString()) {
        throw new ForbiddenException('Family not in your organization');
      }
    }
    const children = (await this.childModel
      .find({ parentId: new Types.ObjectId(familyId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as ChildLean[];
    return children.map((c) => ({
      id: c._id?.toString() ?? '',
      fullName: c.fullName ?? '',
      dateOfBirth:
        c.dateOfBirth instanceof Date
          ? c.dateOfBirth.toISOString().slice(0, 10)
          : (c.dateOfBirth ?? ''),
      gender: c.gender ?? '',
      diagnosis: c.diagnosis,
      medicalHistory: c.medicalHistory,
      allergies: c.allergies,
      medications: c.medications,
      notes: c.notes,
      parentId: c.parentId?.toString(),
    }));
  }

  /**
   * Add a child for the current family. Secured: only the family (parent) can add.
   */
  async createForFamily(
    familyId: string,
    requesterId: string,
    dto: AddChildDto,
  ) {
    if (requesterId !== familyId) {
      throw new ForbiddenException(
        'You can only add children to your own profile',
      );
    }
    const family = await this.userModel.findById(familyId).exec();
    if (!family) throw new NotFoundException('User not found');
    if (family.role !== 'family') {
      throw new BadRequestException('Only family accounts can add children');
    }

    const child = await this.childModel.create({
      fullName: dto.fullName.trim(),
      dateOfBirth: new Date(dto.dateOfBirth),
      gender: dto.gender,
      diagnosis: dto.diagnosis?.trim(),
      medicalHistory: dto.medicalHistory?.trim(),
      allergies: dto.allergies?.trim(),
      medications: dto.medications?.trim(),
      notes: dto.notes?.trim(),
      parentId: family._id,
      organizationId: family.organizationId,
      addedByOrganizationId: family.organizationId,
      lastModifiedBy: new Types.ObjectId(requesterId),
    });

    if (family.organizationId) {
      const org = await this.organizationModel
        .findById(family.organizationId)
        .exec();
      if (org) {
        org.childrenIds = org.childrenIds || [];
        org.childrenIds.push(child._id);
        await org.save();
      }
    }

    return {
      id: child._id.toString(),
      fullName: child.fullName,
      dateOfBirth: child.dateOfBirth,
      gender: child.gender,
      diagnosis: child.diagnosis,
      medicalHistory: child.medicalHistory,
      allergies: child.allergies,
      medications: child.medications,
      notes: child.notes,
      parentId: child.parentId?.toString(),
    };
  }

  // ── Specialist Private Children ──

  async findBySpecialistId(specialistId: string) {
    const children = (await this.childModel
      .find({ specialistId: new Types.ObjectId(specialistId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as ChildLean[];

    return children.map((c) => ({
      _id: c._id?.toString() ?? '',
      fullName: c.fullName ?? '',
      dateOfBirth:
        c.dateOfBirth instanceof Date
          ? c.dateOfBirth.toISOString().slice(0, 10)
          : (c.dateOfBirth ?? ''),
      gender: c.gender ?? '',
      diagnosis: c.diagnosis,
      notes: c.notes,
    }));
  }

  async findBySpecialistIdWithProgress(
    specialistId: string,
  ): Promise<SpecialistPatientSummaryResponse[]> {
    const children = (await this.childModel
      .find({
        specialistId: new Types.ObjectId(specialistId),
        deletedAt: { $exists: false },
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .exec()) as ChildLean[];
    const assignedChildren = children.filter(
      (child): child is ChildLean & { _id: Types.ObjectId } =>
        Boolean(child._id),
    );

    const childIds = assignedChildren.map((child) => child._id.toString());
    const activePlans = await this.specializedPlansService.getPlansByChildIds(
      childIds,
    );
    const plansByChildId = new Map<
      string,
      Array<{
        type: string;
        content?: Record<string, unknown>;
        updatedAt?: Date;
      }>
    >();
    for (const plan of activePlans as Array<{
      childId?: Types.ObjectId | string;
      type: string;
      content?: Record<string, unknown>;
      updatedAt?: Date;
    }>) {
      const childId = plan.childId?.toString?.() ?? '';
      if (!childId) {
        continue;
      }
      const entries = plansByChildId.get(childId) ?? [];
      entries.push({
        type: plan.type,
        content: plan.content,
        updatedAt: plan.updatedAt,
      });
      plansByChildId.set(childId, entries);
    }

    const summaries = assignedChildren.map((child) => {
      const childId = child._id.toString();
      const childPlans = plansByChildId.get(childId) ?? [];
      const totalProgress = childPlans.reduce((sum, plan) => {
        return (
          sum +
          SpecializedPlansService.progressPercent({
            type: plan.type,
            content: plan.content,
          })
        );
      }, 0);
      const progressPercent =
        childPlans.length > 0 ? Math.round(totalProgress / childPlans.length) : 0;
      const lastUpdatedAt = childPlans
        .map((plan) => plan.updatedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0]
        ?.toISOString();

      return {
        id: childId,
        fullName: child.fullName ?? '',
        dateOfBirth:
          child.dateOfBirth instanceof Date
            ? child.dateOfBirth.toISOString().slice(0, 10)
            : (child.dateOfBirth ?? ''),
        gender: child.gender ?? '',
        diagnosis: child.diagnosis,
        progressPercent,
        activePlansCount: childPlans.length,
        lastUpdatedAt,
      };
    });

    return summaries;
  }

  async createForSpecialist(specialistId: string, dto: AddChildDto) {
    const child = await this.childModel.create({
      fullName: dto.fullName.trim(),
      dateOfBirth: new Date(dto.dateOfBirth),
      gender: dto.gender,
      diagnosis: dto.diagnosis?.trim(),
      medicalHistory: dto.medicalHistory?.trim(),
      allergies: dto.allergies?.trim(),
      medications: dto.medications?.trim(),
      notes: dto.notes?.trim(),
      specialistId: new Types.ObjectId(specialistId),
      addedBySpecialistId: new Types.ObjectId(specialistId),
      lastModifiedBy: new Types.ObjectId(specialistId),
    });

    return {
      _id: child._id.toString(),
      fullName: child.fullName,
      dateOfBirth: child.dateOfBirth,
      gender: child.gender,
      diagnosis: child.diagnosis,
      notes: child.notes,
    };
  }

  async createPrivateFamily(specialistId: string, dto: CreateFamilyDto) {
    return this.organizationService.createFamilyMember(null, dto, specialistId);
  }
}
