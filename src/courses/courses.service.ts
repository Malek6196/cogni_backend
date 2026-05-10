import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Course } from './schemas/course.schema';
import { CourseEnrollment } from './schemas/course-enrollment.schema';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CoursesService {
  private static readonly defaultCourseDurationDays = 28;
  private static readonly millisecondsPerDay = 24 * 60 * 60 * 1000;

  constructor(
    @InjectModel(Course.name) private readonly courseModel: Model<Course>,
    @InjectModel(CourseEnrollment.name)
    private readonly enrollmentModel: Model<CourseEnrollment>,
    private readonly notifications: NotificationsService,
  ) {}

  private toOptionalDate(value: unknown): Date | undefined {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
  }

  private idToString(value: unknown): string | undefined {
    if (value instanceof Types.ObjectId) return value.toString();
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && '_id' in value) {
      return this.idToString((value as { _id?: unknown })._id);
    }
    return undefined;
  }

  private calculateEnrollmentTimeline(
    enrollment: Record<string, unknown>,
    course?: Record<string, unknown> | null,
  ) {
    const createdAt = this.toOptionalDate(enrollment.createdAt) ?? new Date();
    const courseStart = this.toOptionalDate(course?.startDate);
    const courseEnd = this.toOptionalDate(course?.endDate);
    const startedAt = courseStart ?? createdAt;
    const fallbackEndsAt = new Date(
      startedAt.getTime() +
        CoursesService.defaultCourseDurationDays *
          CoursesService.millisecondsPerDay,
    );
    const endsAt =
      courseEnd && courseEnd.getTime() > startedAt.getTime()
        ? courseEnd
        : fallbackEndsAt;
    const durationDays = Math.max(
      1,
      Math.ceil(
        (endsAt.getTime() - startedAt.getTime()) /
          CoursesService.millisecondsPerDay,
      ),
    );
    const now = new Date();
    const hasStarted = now.getTime() >= startedAt.getTime();
    const elapsedDays = Math.max(
      0,
      Math.floor(
        (now.getTime() - startedAt.getTime()) /
          CoursesService.millisecondsPerDay,
      ),
    );
    const timelineProgress = hasStarted
      ? Math.min(
          100,
          Math.max(0, Math.floor((elapsedDays / durationDays) * 100)),
        )
      : 0;
    const storedProgress =
      typeof enrollment.progressPercent === 'number'
        ? enrollment.progressPercent
        : 0;
    const progressPercent = Math.min(
      100,
      Math.max(storedProgress, timelineProgress),
    );
    const status =
      progressPercent >= 100
        ? 'completed'
        : hasStarted
          ? 'in_progress'
          : 'enrolled';
    const completedAt =
      this.toOptionalDate(enrollment.completedAt) ??
      (status === 'completed' ? endsAt : undefined);
    const daysUntilStart = Math.max(
      0,
      Math.ceil(
        (startedAt.getTime() - now.getTime()) /
          CoursesService.millisecondsPerDay,
      ),
    );
    const canCancel =
      status === 'enrolled' &&
      progressPercent === 0 &&
      startedAt.getTime() > now.getTime();

    return {
      startedAt,
      endsAt,
      durationDays,
      daysUntilStart,
      daysElapsed: Math.min(elapsedDays, durationDays),
      remainingDays: Math.max(durationDays - elapsedDays, 0),
      progressPercent,
      status,
      completedAt,
      progressSource: 'timeline',
      canCancel,
    };
  }

  async create(dto: {
    title: string;
    description?: string;
    slug: string;
    isQualificationCourse?: boolean;
    startDate?: Date;
    endDate?: Date;
    courseType?: string;
    price?: string;
    location?: string;
    enrollmentLink?: string;
    certification?: string;
    targetAudience?: string;
    prerequisites?: string;
    sourceUrl?: string;
  }) {
    const existing = await this.courseModel.findOne({ slug: dto.slug }).exec();
    if (existing) {
      return this.findAll();
    }
    await this.courseModel.create(dto);
    return this.findAll();
  }

  async findAll(filters?: {
    qualificationOnly?: boolean;
    courseType?: string;
    hasCertification?: boolean;
  }) {
    const query: Record<string, unknown> = {};
    if (filters?.qualificationOnly === true) query.isQualificationCourse = true;
    if (filters?.courseType) query.courseType = filters.courseType;
    if (filters?.hasCertification === true) {
      query.certification = { $exists: true, $nin: [null, ''] };
    }
    const list = await this.courseModel
      .find(query)
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return list.map((c) => {
      const r = c as Record<string, unknown>;
      return {
        id: r._id?.toString?.(),
        title: r.title,
        description: r.description,
        slug: r.slug,
        isQualificationCourse: r.isQualificationCourse,
        startDate: r.startDate,
        endDate: r.endDate,
        courseType: r.courseType,
        price: r.price,
        location: r.location,
        enrollmentLink: r.enrollmentLink,
        certification: r.certification,
        targetAudience: r.targetAudience,
        prerequisites: r.prerequisites,
        durationDays: CoursesService.defaultCourseDurationDays,
      };
    });
  }

  async enroll(userId: string, courseId: string) {
    const course = await this.courseModel.findById(courseId).exec();
    if (!course) throw new NotFoundException('Course not found');
    const existing = await this.enrollmentModel
      .findOne({
        userId: new Types.ObjectId(userId),
        courseId: new Types.ObjectId(courseId),
      })
      .exec();
    if (existing) {
      return this.myEnrollments(userId);
    }
    await this.enrollmentModel.create({
      userId: new Types.ObjectId(userId),
      courseId: new Types.ObjectId(courseId),
      status: 'enrolled',
      progressPercent: 0,
    });
    return this.myEnrollments(userId);
  }

  async myEnrollments(userId: string) {
    const list = await this.enrollmentModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate(
        'courseId',
        'title description slug isQualificationCourse startDate endDate courseType price location enrollmentLink certification targetAudience prerequisites',
      )
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return list.map((e) => {
      const o = e as Record<string, unknown>;
      const course = o.courseId as Record<string, unknown> | null;
      const timeline = this.calculateEnrollmentTimeline(o, course);
      const courseId =
        this.idToString(course?._id) ?? this.idToString(o.courseId);
      return {
        id: this.idToString(o._id),
        courseId,
        status: timeline.status,
        progressPercent: timeline.progressPercent,
        completedAt: timeline.completedAt,
        startedAt: timeline.startedAt,
        endsAt: timeline.endsAt,
        durationDays: timeline.durationDays,
        daysUntilStart: timeline.daysUntilStart,
        daysElapsed: timeline.daysElapsed,
        remainingDays: timeline.remainingDays,
        progressSource: timeline.progressSource,
        canCancel: timeline.canCancel,
        course: course
          ? {
              id: courseId,
              title: course.title,
              description: course.description,
              slug: course.slug,
              isQualificationCourse: course.isQualificationCourse,
              startDate: course.startDate,
              endDate: course.endDate,
              courseType: course.courseType,
              price: course.price,
              location: course.location,
              enrollmentLink: course.enrollmentLink,
              certification: course.certification,
              targetAudience: course.targetAudience,
              prerequisites: course.prerequisites,
              durationDays: timeline.durationDays,
            }
          : null,
      };
    });
  }

  /**
   * Admin: list enrollments, optionally filtered by userId. Used to show volunteer course progress.
   */
  async listEnrollmentsForAdmin(userId?: string) {
    const query: Record<string, unknown> = {};
    if (userId) query.userId = new Types.ObjectId(userId);
    const list = await this.enrollmentModel
      .find(query)
      .populate('userId', 'fullName email')
      .populate(
        'courseId',
        'title slug isQualificationCourse startDate endDate courseType certification',
      )
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return list.map((e) => {
      const o = e as Record<string, unknown>;
      const course = o.courseId as Record<string, unknown> | null;
      const timeline = this.calculateEnrollmentTimeline(o, course);
      const user = o.userId as Record<string, unknown> | null;
      const courseId =
        this.idToString(course?._id) ?? this.idToString(o.courseId);
      return {
        id: this.idToString(o._id),
        userId: this.idToString(o.userId),
        courseId,
        status: timeline.status,
        progressPercent: timeline.progressPercent,
        completedAt: timeline.completedAt,
        startedAt: timeline.startedAt,
        endsAt: timeline.endsAt,
        durationDays: timeline.durationDays,
        daysUntilStart: timeline.daysUntilStart,
        daysElapsed: timeline.daysElapsed,
        remainingDays: timeline.remainingDays,
        progressSource: timeline.progressSource,
        canCancel: timeline.canCancel,
        user: user ? { fullName: user.fullName, email: user.email } : null,
        course: course
          ? {
              id: courseId,
              title: course.title,
              slug: course.slug,
              isQualificationCourse: course.isQualificationCourse,
              startDate: course.startDate,
              endDate: course.endDate,
              courseType: course.courseType,
              certification: course.certification,
              durationDays: timeline.durationDays,
            }
          : null,
      };
    });
  }

  async updateProgress(
    userId: string,
    enrollmentId: string,
    progressPercent: number,
  ) {
    const enrollment = await this.enrollmentModel
      .findOne({
        _id: enrollmentId,
        userId: new Types.ObjectId(userId),
      })
      .exec();
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    const wasCompleted =
      enrollment.status === 'completed' && enrollment.progressPercent >= 100;
    enrollment.progressPercent = Math.min(100, Math.max(0, progressPercent));
    if (enrollment.progressPercent >= 100) {
      enrollment.status = 'completed';
      enrollment.completedAt = new Date();
    } else {
      enrollment.status = 'in_progress';
    }
    await enrollment.save();
    if (
      enrollment.progressPercent >= 100 &&
      enrollment.status === 'completed' &&
      !wasCompleted
    ) {
      const course = await this.courseModel
        .findById(enrollment.courseId)
        .lean()
        .exec();
      const isQualification = (course as Record<string, unknown>)
        ?.isQualificationCourse;
      if (isQualification) {
        await this.notifications.createForUser(userId, {
          type: 'volunteer_training_complete',
          title: 'Formation qualifiante terminée',
          description:
            "Passez le test de certification pour débloquer l'Agenda et les Messages.",
          data: {
            courseId: enrollment.courseId?.toString?.(),
          },
        });
      }
    }
    return this.myEnrollments(userId);
  }

  async cancelEnrollment(userId: string, enrollmentId: string) {
    const enrollment = await this.enrollmentModel
      .findOne({
        _id: enrollmentId,
        userId: new Types.ObjectId(userId),
      })
      .populate('courseId', 'startDate endDate')
      .lean()
      .exec();
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const enrollmentRecord = enrollment as Record<string, unknown>;
    const course = enrollmentRecord.courseId as Record<string, unknown> | null;
    const timeline = this.calculateEnrollmentTimeline(enrollmentRecord, course);
    if (!timeline.canCancel) {
      throw new ForbiddenException(
        'Enrollment can only be cancelled before the course starts',
      );
    }

    await this.enrollmentModel
      .deleteOne({
        _id: enrollmentId,
        userId: new Types.ObjectId(userId),
      })
      .exec();
    return this.myEnrollments(userId);
  }

  /**
   * Returns true if the user has at least one completed enrollment in a qualification course.
   */
  async hasCompletedQualificationCourse(userId: string): Promise<boolean> {
    const list = await this.enrollmentModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate('courseId', 'isQualificationCourse')
      .lean()
      .exec();
    for (const e of list) {
      const enrollment = e as Record<string, unknown>;
      const course = enrollment.courseId as {
        isQualificationCourse?: boolean;
      } | null;
      const timeline = this.calculateEnrollmentTimeline(
        enrollment,
        course as Record<string, unknown> | null,
      );
      if (course?.isQualificationCourse && timeline.progressPercent >= 100) {
        return true;
      }
    }
    return false;
  }
}
