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
  Appointment,
  AppointmentDocument,
} from '../appointments/schemas/appointment.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organization/schemas/organization.schema';
import { OrganizationService } from '../organization/organization.service';
import { AddChildDto } from './dto/add-child.dto';
import { CreateFamilyDto } from '../organization/dto/create-family.dto';

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
}

interface ProviderPatientLean {
  id: string;
  fullName: string;
  dateOfBirth: string;
  parentId?: string;
  parentFullName?: string;
}

const _specialistCareProviderTypes = new Set([
  'speech_therapist',
  'occupational_therapist',
  'psychologist',
  'doctor',
  'ergotherapist',
]);

@Injectable()
export class ChildrenService {
  constructor(
    @InjectModel(Child.name) private childModel: Model<ChildDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Organization.name)
    private organizationModel: Model<OrganizationDocument>,
    @InjectModel(Appointment.name)
    private appointmentModel: Model<AppointmentDocument>,
    private organizationService: OrganizationService,
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

  /**
   * Specialist patients (from real bookings).
   * Source of truth: appointments where providerId = specialistId and childId is set.
   *
   * Privacy: returns only minimal child identity + parent's display name (no PII beyond names).
   */
  async listPatientsForSpecialistFromAppointments(
    specialistId: string,
  ): Promise<ProviderPatientLean[]> {
    const appts = await this.appointmentModel
      .find({
        providerId: new Types.ObjectId(specialistId),
        childId: { $exists: true, $ne: null },
        status: { $ne: 'cancelled' },
      })
      .select('childId')
      .lean()
      .exec();

    const childIds = Array.from(
      new Set(
        (appts as unknown as { childId?: Types.ObjectId }[])
          .map((a) => a.childId?.toString())
          .filter(Boolean) as string[],
      ),
    );
    if (childIds.length === 0) return [];

    const children = (await this.childModel
      .find({
        _id: { $in: childIds.map((id) => new Types.ObjectId(id)) },
        deletedAt: { $exists: false },
      })
      .select('fullName dateOfBirth parentId')
      .lean()
      .exec()) as ChildLean[];

    const parentIds = Array.from(
      new Set(
        children.map((c) => c.parentId?.toString()).filter(Boolean) as string[],
      ),
    );

    const parents = await this.userModel
      .find({ _id: { $in: parentIds.map((id) => new Types.ObjectId(id)) } })
      .select('fullName')
      .lean()
      .exec();
    const parentNameById = new Map<string, string>();
    for (const p of parents as unknown as {
      _id?: Types.ObjectId;
      fullName?: string;
    }[]) {
      if (p._id) parentNameById.set(p._id.toString(), p.fullName ?? '');
    }

    return children
      .map((c) => {
        const parentId = c.parentId?.toString();
        return {
          id: c._id?.toString() ?? '',
          fullName: c.fullName ?? '',
          dateOfBirth:
            c.dateOfBirth instanceof Date
              ? c.dateOfBirth.toISOString().slice(0, 10)
              : (c.dateOfBirth ?? ''),
          parentId,
          parentFullName: parentId ? parentNameById.get(parentId) : undefined,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async assertCareProviderIsSpecialist(userId: string): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('role careProviderType')
      .lean()
      .exec();
    const lean = user as unknown as {
      role?: string;
      careProviderType?: string;
    };
    if (!lean) throw new NotFoundException('User not found');
    if (lean.role !== 'careProvider') {
      throw new ForbiddenException('Not a care provider account');
    }
    if (
      !lean.careProviderType ||
      !_specialistCareProviderTypes.has(lean.careProviderType)
    ) {
      throw new ForbiddenException('Not authorized');
    }
  }
}
