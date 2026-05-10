import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TrainingCourse } from './schemas/training-course.schema';
import { TrainingEnrollment } from './schemas/training-enrollment.schema';
import { QuizSessionAnalysis } from './schemas/quiz-session-analysis.schema';
import { CreateTrainingCourseDto } from './dto/create-training-course.dto';
import { UpdateTrainingCourseDto } from './dto/update-training-course.dto';
import { ApproveTrainingCourseDto } from './dto/approve-training-course.dto';
import {
  AnalyzeQuizSessionDto,
  AttentionDataDto,
  BehaviorFlagDto,
  BehaviorSummaryDto,
} from './dto/analyze-quiz-session.dto';
import { VolunteersService } from '../volunteers/volunteers.service';

const QUIZ_PASS_THRESHOLD_PERCENT = 80;

interface QuizQuestionRecord {
  question: string;
  options?: string[];
  correctIndex?: number;
  correctAnswer?: string;
  order?: number;
  type?: 'mcq' | 'true_false' | 'fill_blank';
}

export interface QuizReviewItem {
  questionIndex: number;
  correctIndex?: number;
  correctOptionText?: string;
  correctAnswer?: string;
  userSelectedIndex?: number;
  userAnswer?: string;
  isCorrect: boolean;
}

@Injectable()
export class TrainingService {
  constructor(
    @InjectModel(TrainingCourse.name)
    private readonly courseModel: Model<TrainingCourse>,
    @InjectModel(TrainingEnrollment.name)
    private readonly enrollmentModel: Model<TrainingEnrollment>,
    @InjectModel(QuizSessionAnalysis.name)
    private readonly sessionAnalysisModel: Model<QuizSessionAnalysis>,
    @Inject(forwardRef(() => VolunteersService))
    private readonly volunteersService: VolunteersService,
  ) {}

  /** List courses approved for app (caregivers) — only approved, ordered; quiz answers stripped */
  async listApproved() {
    const list = await this.courseModel
      .find({ approved: true })
      .sort({ order: 1, createdAt: 1 })
      .lean()
      .exec();
    return list.map((c) =>
      this.toCourseResponse(c as Record<string, unknown>, false, true),
    );
  }

  /** Admin: list all courses including unapproved */
  async listAll() {
    const list = await this.courseModel
      .find({})
      .sort({ order: 1, createdAt: 1 })
      .lean()
      .exec();
    return list.map((c) =>
      this.toCourseResponse(c as Record<string, unknown>, true, false),
    );
  }

  /** Get one course by id; only approved for non-admin; strip quiz answers for app */
  async getById(courseId: string, admin = false) {
    const course = await this.courseModel.findById(courseId).lean().exec();
    if (!course) throw new NotFoundException('Training course not found');
    const c = course as Record<string, unknown>;
    if (!admin && !c.approved) throw new NotFoundException('Course not found');
    return this.toCourseResponse(c, admin, !admin);
  }

  /** Seed the 3 generated courses (from scraped/official content) if collection is empty */
  async seedCoursesIfEmpty(): Promise<void> {
    const count = await this.courseModel.countDocuments().exec();
    if (count > 0) return;
    const seedPath = path.join(
      process.cwd(),
      'data',
      'training-courses-seed.json',
    );
    if (!fs.existsSync(seedPath)) return;
    try {
      const raw = fs.readFileSync(seedPath, 'utf-8');
      const courses = JSON.parse(raw) as CreateTrainingCourseDto[];
      if (!Array.isArray(courses) || courses.length === 0) return;
      await this.courseModel.insertMany(courses);
    } catch {
      // ignore: seed is optional
    }
  }

  /** Create course (admin or scraper) */
  async create(dto: CreateTrainingCourseDto) {
    const created = await this.courseModel.create({
      title: dto.title,
      description: dto.description,
      contentSections: dto.contentSections ?? [],
      sourceUrl: dto.sourceUrl,
      topics: dto.topics ?? [],
      quiz: dto.quiz ?? [],
      approved: dto.approved ?? false,
      order: dto.order ?? 0,
    });
    return this.toCourseResponse(
      created.toObject() as unknown as Record<string, unknown>,
      true,
      false,
    );
  }

  /** Update course (admin) */
  async update(courseId: string, dto: UpdateTrainingCourseDto) {
    const course = await this.courseModel
      .findByIdAndUpdate(
        courseId,
        {
          $set: {
            ...(dto.title != null && { title: dto.title }),
            ...(dto.description != null && { description: dto.description }),
            ...(dto.contentSections != null && {
              contentSections: dto.contentSections,
            }),
            ...(dto.sourceUrl != null && { sourceUrl: dto.sourceUrl }),
            ...(dto.topics != null && { topics: dto.topics }),
            ...(dto.quiz != null && { quiz: dto.quiz }),
            ...(dto.order != null && { order: dto.order }),
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!course) throw new NotFoundException('Training course not found');
    return this.toCourseResponse(
      course as unknown as Record<string, unknown>,
      true,
      false,
    );
  }

  /** Approve or reject course (admin) */
  async approve(
    courseId: string,
    adminId: string,
    dto: ApproveTrainingCourseDto,
  ) {
    const course = await this.courseModel
      .findByIdAndUpdate(
        courseId,
        {
          $set: {
            approved: dto.approved,
            professionalComments: dto.professionalComments,
            approvedBy: new Types.ObjectId(adminId),
            approvedAt: new Date(),
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!course) throw new NotFoundException('Training course not found');
    return this.toCourseResponse(
      course as unknown as Record<string, unknown>,
      true,
      false,
    );
  }

  /** Enroll user in a course (start training) */
  async enroll(userId: string, courseId: string) {
    const course = await this.courseModel
      .findOne({ _id: courseId, approved: true })
      .exec();
    if (!course) throw new NotFoundException('Course not found');
    const existing = await this.enrollmentModel
      .findOne({
        userId: new Types.ObjectId(userId),
        courseId: new Types.ObjectId(courseId),
      })
      .exec();
    if (existing) return this.getMyEnrollments(userId);
    await this.enrollmentModel.create({
      userId: new Types.ObjectId(userId),
      courseId: new Types.ObjectId(courseId),
      progressPercent: 0,
      contentCompleted: false,
      quizPassed: false,
      quizAttempts: 0,
    });
    return this.getMyEnrollments(userId);
  }

  /** Get my enrollments with course summary */
  async getMyEnrollments(userId: string) {
    const list = await this.enrollmentModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate('courseId', 'title description order')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    const courseIds = list.map(
      (e) => (e as Record<string, unknown>).courseId as Types.ObjectId,
    );
    const courses = await this.courseModel
      .find({ _id: { $in: courseIds }, approved: true })
      .lean()
      .exec();
    const courseMap = new Map(
      courses.map((c) => [(c as { _id: Types.ObjectId })._id.toString(), c]),
    );
    return list.map((e) => {
      const o = e as Record<string, unknown>;
      const c = courseMap.get(
        (o.courseId as Types.ObjectId)?.toString?.() ?? '',
      ) as Record<string, unknown> | undefined;
      return {
        id: (o._id as { toString(): string })?.toString?.(),
        courseId: (o.courseId as Types.ObjectId)?.toString?.(),
        progressPercent: o.progressPercent,
        contentCompleted: o.contentCompleted,
        quizPassed: o.quizPassed,
        quizScorePercent: o.quizScorePercent,
        quizAttempts: o.quizAttempts,
        completedAt: o.completedAt,
        course: c
          ? {
              title: c.title,
              description: c.description,
              order: c.order,
            }
          : null,
      };
    });
  }

  /** Mark content as completed (user finished reading). Auto-enrolls if not yet enrolled. */
  async markContentCompleted(userId: string, courseId: string) {
    let enrollment = await this.enrollmentModel
      .findOne({
        userId: new Types.ObjectId(userId),
        courseId: new Types.ObjectId(courseId),
      })
      .exec();
    if (!enrollment) {
      await this.enroll(userId, courseId);
      enrollment = await this.enrollmentModel
        .findOne({
          userId: new Types.ObjectId(userId),
          courseId: new Types.ObjectId(courseId),
        })
        .exec();
    }
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    enrollment.contentCompleted = true;
    enrollment.progressPercent = Math.max(
      enrollment.progressPercent,
      enrollment.quizPassed ? 100 : 50,
    );
    await enrollment.save();
    return this.getMyEnrollments(userId);
  }

  /** Submit quiz answers and record score. Returns review with correct answers for learning. */
  async submitQuiz(
    userId: string,
    courseId: string,
    answers: number[],
    textAnswers?: string[],
  ): Promise<{
    scorePercent: number;
    passed: boolean;
    correct: number;
    total: number;
    enrollments: Awaited<ReturnType<typeof this.getMyEnrollments>>;
    review: QuizReviewItem[];
  }> {
    const course = await this.courseModel
      .findOne({ _id: courseId, approved: true })
      .lean()
      .exec();
    if (!course) throw new NotFoundException('Course not found');
    const quiz = (course as Record<string, unknown>).quiz as
      | QuizQuestionRecord[]
      | undefined;
    if (!Array.isArray(quiz) || quiz.length === 0) {
      throw new BadRequestException('Course has no quiz');
    }
    if (answers.length !== quiz.length) {
      throw new BadRequestException(
        `Expected ${quiz.length} answers, got ${answers.length}`,
      );
    }
    const review: QuizReviewItem[] = [];
    let correct = 0;
    for (let i = 0; i < quiz.length; i++) {
      const q = quiz[i];
      const type = q.type ?? 'mcq';
      const selected = answers[i];
      const textAnswer =
        textAnswers && textAnswers[i] !== undefined
          ? String(textAnswers[i]).trim()
          : '';

      let isCorrect = false;
      if (type === 'fill_blank') {
        const expected = (q.correctAnswer ?? '').trim().toLowerCase();
        const actual = textAnswer.toLowerCase();
        isCorrect = !!expected && actual === expected;
        review.push({
          questionIndex: i,
          correctAnswer: q.correctAnswer,
          userAnswer: textAnswer || undefined,
          isCorrect,
        });
      } else {
        const options = q.options ?? [];
        const correctIndex = q.correctIndex ?? 0;
        const valid = selected >= 0 && selected < options.length;
        isCorrect = valid && selected === correctIndex;
        review.push({
          questionIndex: i,
          correctIndex,
          correctOptionText: options[correctIndex],
          userSelectedIndex: selected >= 0 ? selected : undefined,
          isCorrect,
        });
      }
      if (isCorrect) correct++;
    }
    const scorePercent = Math.round((correct / quiz.length) * 100);
    const passed = scorePercent >= QUIZ_PASS_THRESHOLD_PERCENT;

    let enrollment = await this.enrollmentModel
      .findOne({
        userId: new Types.ObjectId(userId),
        courseId: new Types.ObjectId(courseId),
      })
      .exec();
    if (!enrollment) {
      await this.enroll(userId, courseId);
      enrollment = await this.enrollmentModel
        .findOne({
          userId: new Types.ObjectId(userId),
          courseId: new Types.ObjectId(courseId),
        })
        .exec();
    }
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    enrollment.quizAttempts = (enrollment.quizAttempts ?? 0) + 1;
    enrollment.quizScorePercent = scorePercent;
    enrollment.quizPassed = passed;
    if (passed) {
      enrollment.progressPercent = 100;
      enrollment.completedAt = new Date();
    }
    await enrollment.save();

    if (passed) {
      const allPassed = await this.haveAllApprovedTrainingCoursesPassed(userId);
      if (allPassed) {
        await this.volunteersService.setTrainingCertifiedFromTrainingCourses(
          userId,
        );
      }
    }

    return {
      scorePercent,
      passed,
      correct,
      total: quiz.length,
      enrollments: await this.getMyEnrollments(userId),
      review,
    };
  }

  /** True if user has passed every approved training course (quiz passed, progress 100%). */
  private async haveAllApprovedTrainingCoursesPassed(
    userId: string,
  ): Promise<boolean> {
    const courses = await this.courseModel
      .find({ approved: true })
      .sort({ order: 1 })
      .lean()
      .exec();
    if (courses.length === 0) return false;
    const enrollments = await this.enrollmentModel
      .find({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    const passedByCourse = new Set(
      (enrollments as Record<string, unknown>[])
        .filter((e) => e.progressPercent === 100 && e.quizPassed === true)
        .map((e) => (e.courseId as Types.ObjectId)?.toString?.()),
    );
    for (const c of courses) {
      const id = (c as { _id: Types.ObjectId })._id.toString();
      if (!passedByCourse.has(id)) return false;
    }
    return true;
  }

  /** Check if user can access next course (previous completed + quiz passed) */
  async getNextUnlockedCourseId(userId: string): Promise<string | null> {
    const enrollments = await this.enrollmentModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    const courses = await this.courseModel
      .find({ approved: true })
      .sort({ order: 1 })
      .lean()
      .exec();
    const completedIds = new Set(
      (enrollments as Record<string, unknown>[])
        .filter((e) => e.progressPercent === 100 && e.quizPassed === true)
        .map((e) => (e.courseId as Types.ObjectId)?.toString?.()),
    );
    for (const c of courses) {
      const id = (c as { _id: Types.ObjectId })._id.toString();
      if (!completedIds.has(id)) return id;
    }
    return null;
  }

  private toCourseResponse(
    c: Record<string, unknown>,
    includeApproval = false,
    stripQuizAnswers = true,
  ) {
    const quizRaw = (c.quiz ?? []) as QuizQuestionRecord[];
    const quiz = stripQuizAnswers
      ? quizRaw.map((q) => ({
          question: q.question,
          options: q.options ?? [],
          order: q.order ?? 0,
          type: q.type,
        }))
      : quizRaw;
    const out: Record<string, unknown> = {
      id: (c._id as { toString(): string })?.toString?.(),
      title: c.title,
      description: c.description,
      contentSections: c.contentSections ?? [],
      sourceUrl: c.sourceUrl,
      topics: c.topics ?? [],
      quiz,
      order: c.order ?? 0,
    };
    if (includeApproval) {
      out.approved = c.approved;
      out.approvedBy = (c.approvedBy as Types.ObjectId)?.toString?.();
      out.approvedAt = c.approvedAt;
      out.professionalComments = c.professionalComments;
    }
    return out;
  }

  // ── Quiz Session Analysis ────────────────────────────────────────────────

  /**
   * Store and optionally re-score a quiz session analysis from the mobile client.
   *
   * ML-ready hook: the server-side scoring can be upgraded to call an external
   * ML model without any change to the Flutter app — just swap the scoring logic
   * inside this method and update `modelVersion`.
   */
  async analyzeSession(
    userId: string,
    dto: AnalyzeQuizSessionDto,
  ): Promise<Record<string, unknown>> {
    const normalizedFlags = this._normalizeFlags(dto.flags ?? []);
    const derivedFlags = this._deriveFlagsFromSummary(
      dto.behaviorSummary,
      dto.attentionData,
    );
    const mergedFlags = Array.from(
      new Set<BehaviorFlagDto>([...normalizedFlags, ...derivedFlags]),
    );

    // Server-side re-scoring based on validated aggregate metrics.
    // ML-ready: replace these methods with model inference.
    const serverEngagementScore = this._serverSideEngagement(dto, mergedFlags);
    const serverReliabilityScore = this._serverSideReliability(
      dto,
      mergedFlags,
    );
    const riskLevel = this._computeRiskLevel(
      serverEngagementScore,
      serverReliabilityScore,
      mergedFlags,
    );

    // Persist (upsert latest result for this user+quiz pair).
    const doc = await this.sessionAnalysisModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        quizId: new Types.ObjectId(dto.quizId),
      },
      {
        $set: {
          engagementScore: serverEngagementScore,
          reliabilityScore: serverReliabilityScore,
          flags: mergedFlags,
          behaviorSummary: dto.behaviorSummary,
          attentionData: dto.attentionData ?? null,
          modelVersion: 'rule-based-v2',
          riskLevel,
        },
      },
      { upsert: true, new: true, lean: true },
    );

    return {
      userId,
      quizId: dto.quizId,
      engagementScore: serverEngagementScore,
      reliabilityScore: serverReliabilityScore,
      flags: mergedFlags,
      behaviorSummary: dto.behaviorSummary,
      attentionData: dto.attentionData ?? null,
      modelVersion: 'rule-based-v2',
      riskLevel,
      savedId: (doc as { _id: Types.ObjectId })?._id?.toString?.(),
      feedback: this._generateServerFeedback(
        mergedFlags,
        serverEngagementScore,
        serverReliabilityScore,
      ),
    };
  }

  /** List all session analyses for a given quiz (admin view). */
  async getSessionAnalyses(quizId: string): Promise<QuizSessionAnalysis[]> {
    return this.sessionAnalysisModel
      .find({ quizId: new Types.ObjectId(quizId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec() as Promise<QuizSessionAnalysis[]>;
  }

  /** List all session analyses for a given user (admin view). */
  async getUserAnalyses(userId: string): Promise<QuizSessionAnalysis[]> {
    return this.sessionAnalysisModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec() as Promise<QuizSessionAnalysis[]>;
  }

  /** Admin: aggregate behavior analytics with optional filters. */
  async getSessionAnalysesSummary(params?: {
    quizId?: string;
    userId?: string;
    days?: number;
  }): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = {};
    if (params?.quizId) query.quizId = new Types.ObjectId(params.quizId);
    if (params?.userId) query.userId = new Types.ObjectId(params.userId);

    const days = params?.days ?? 30;
    if (days > 0) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: since };
    }

    const docs = (await this.sessionAnalysisModel
      .find(query)
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as Array<
      QuizSessionAnalysis & {
        _id: Types.ObjectId;
        userId: Types.ObjectId;
        createdAt?: Date;
      }
    >;

    if (docs.length === 0) {
      return {
        totalSessions: 0,
        uniqueUsers: 0,
        avgEngagement: 0,
        avgReliability: 0,
        riskDistribution: { low: 0, medium: 0, high: 0 },
        topFlags: [],
        dailyTrend: [],
      };
    }

    const uniqueUsers = new Set<string>();
    let sumEngagement = 0;
    let sumReliability = 0;
    const riskDistribution = { low: 0, medium: 0, high: 0 };
    const flagCounts = new Map<string, number>();
    const trend = new Map<
      string,
      {
        sessions: number;
        sumEngagement: number;
        sumReliability: number;
        highRisk: number;
      }
    >();

    for (const doc of docs) {
      uniqueUsers.add(doc.userId.toString());
      sumEngagement += doc.engagementScore ?? 0;
      sumReliability += doc.reliabilityScore ?? 0;

      const risk = doc.riskLevel ?? 'low';
      if (risk === 'high') riskDistribution.high++;
      else if (risk === 'medium') riskDistribution.medium++;
      else riskDistribution.low++;

      for (const flag of doc.flags ?? []) {
        flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
      }

      const dayKey = (doc.createdAt ?? new Date()).toISOString().slice(0, 10);
      const bucket = trend.get(dayKey) ?? {
        sessions: 0,
        sumEngagement: 0,
        sumReliability: 0,
        highRisk: 0,
      };
      bucket.sessions += 1;
      bucket.sumEngagement += doc.engagementScore ?? 0;
      bucket.sumReliability += doc.reliabilityScore ?? 0;
      if (risk === 'high') bucket.highRisk += 1;
      trend.set(dayKey, bucket);
    }

    const topFlags = Array.from(flagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([flag, count]) => ({ flag, count }));

    const dailyTrend = Array.from(trend.entries()).map(([date, bucket]) => ({
      date,
      sessions: bucket.sessions,
      avgEngagement: Math.round(bucket.sumEngagement / bucket.sessions),
      avgReliability: Math.round(bucket.sumReliability / bucket.sessions),
      highRiskSessions: bucket.highRisk,
    }));

    return {
      totalSessions: docs.length,
      uniqueUsers: uniqueUsers.size,
      avgEngagement: Math.round(sumEngagement / docs.length),
      avgReliability: Math.round(sumReliability / docs.length),
      riskDistribution,
      topFlags,
      dailyTrend,
    };
  }

  // ── Private: server-side rule engine ────────────────────────────────────
  // These mirror the Flutter BehaviorAnalyzer thresholds.
  // To upgrade to ML: replace these methods with an HTTP call to your model.

  private _serverSideEngagement(
    dto: AnalyzeQuizSessionDto,
    flags: BehaviorFlagDto[],
  ): number {
    let score = 100;
    const s = dto.behaviorSummary;

    // App interruptions and inactivity penalties.
    score -= Math.min(s.interruptions * 8, 24);
    score -= Math.min(((s.totalInactivityMs ?? 0) / 1000 / 30) * 20, 20);

    // Fast answers penalty (-3 each, up to -15).
    score -= Math.min(s.tooFastCount * 3, 15);

    // Answer changes penalty (-2 each, up to -10).
    score -= Math.min(s.answerChanges * 2, 10);

    // Pacing instability and fatigue signals.
    score -= Math.min((s.paceVariability ?? 0) * 18, 18);
    if (flags.includes(BehaviorFlagDto.FATIGUE_SIGNALS)) score -= 8;
    if (flags.includes(BehaviorFlagDto.INCONSISTENT_PACING)) score -= 8;

    // Reward stable deliberation.
    if ((s.avgHesitationMs ?? 0) < 5000 && s.tooFastCount === 0) {
      score += 5;
    }

    // Camera attention bonus/penalty (±15).
    if (dto.attentionData && dto.attentionData.totalSamples > 0) {
      const delta = ((dto.attentionData.overallScore - 70) / 100) * 15;
      score += delta;
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  private _serverSideReliability(
    dto: AnalyzeQuizSessionDto,
    flags: BehaviorFlagDto[],
  ): number {
    let score = 100;
    const s = dto.behaviorSummary;

    if (flags.includes(BehaviorFlagDto.FAST_ANSWERS)) score -= 20;
    if (flags.includes(BehaviorFlagDto.FREQUENT_APP_SWITCHING)) score -= 15;
    if (flags.includes(BehaviorFlagDto.RANDOM_PATTERNS)) score -= 10;
    if (flags.includes(BehaviorFlagDto.REPEATED_WRONG_PATTERNS)) score -= 10;
    if (flags.includes(BehaviorFlagDto.HIGH_HESITATION)) score -= 5;
    if (flags.includes(BehaviorFlagDto.INCONSISTENT_PACING)) score -= 8;
    if (flags.includes(BehaviorFlagDto.FATIGUE_SIGNALS)) score -= 8;

    // Suspicious touch bursts / unstable quality.
    score -= Math.min((s.tapBurstScore ?? 0) * 20, 20);
    if ((s.longestWrongStreak ?? 0) >= 4) score -= 6;
    const canAssessLateDrift =
      (s.totalDurationMs ?? 0) >= 120000 ||
      (s.tooFastCount ?? 0) + (s.slowCount ?? 0) >= 8;
    if (canAssessLateDrift) {
      score -= Math.min((s.lateSessionAccuracyDrop ?? 0) * 12, 12);
    }

    // Camera absence penalty (up to -15).
    if (dto.attentionData && dto.attentionData.totalSamples > 0) {
      const absencePenalty = (1 - dto.attentionData.facePresenceRatio) * 15;
      score -= Math.min(absencePenalty, 15);
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  private _computeRiskLevel(
    engagement: number,
    reliability: number,
    flags: BehaviorFlagDto[],
  ): 'low' | 'medium' | 'high' {
    const critical = [
      BehaviorFlagDto.FAST_ANSWERS,
      BehaviorFlagDto.FREQUENT_APP_SWITCHING,
      BehaviorFlagDto.RANDOM_PATTERNS,
      BehaviorFlagDto.FATIGUE_SIGNALS,
    ];
    const criticalCount = critical.filter((flag) =>
      flags.includes(flag),
    ).length;

    if (engagement < 45 || reliability < 45 || criticalCount >= 3) {
      return 'high';
    }
    if (engagement < 70 || reliability < 70 || criticalCount >= 1) {
      return 'medium';
    }
    return 'low';
  }

  private _normalizeFlags(flags: BehaviorFlagDto[]): BehaviorFlagDto[] {
    const allowed = new Set(Object.values(BehaviorFlagDto));
    return flags.filter((flag) => allowed.has(flag));
  }

  private _deriveFlagsFromSummary(
    summary: BehaviorSummaryDto,
    attention?: AttentionDataDto,
  ): BehaviorFlagDto[] {
    const derived: BehaviorFlagDto[] = [];
    const estimatedQuestionCount =
      (summary.tooFastCount ?? 0) + (summary.slowCount ?? 0);
    const canAssessLateDrift =
      (summary.totalDurationMs ?? 0) >= 120000 || estimatedQuestionCount >= 8;

    if (summary.tooFastCount >= 3) derived.push(BehaviorFlagDto.FAST_ANSWERS);
    if (summary.interruptions > 2)
      derived.push(BehaviorFlagDto.FREQUENT_APP_SWITCHING);
    if (
      (summary.avgHesitationMs ?? 0) > 15000 ||
      (summary.hesitationSpikes ?? 0) >= 3
    ) {
      derived.push(BehaviorFlagDto.HIGH_HESITATION);
    }
    if (summary.answerChanges >= 6 || (summary.tapBurstScore ?? 0) > 0.45) {
      derived.push(BehaviorFlagDto.RANDOM_PATTERNS);
    }
    if ((summary.longestWrongStreak ?? 0) >= 3) {
      derived.push(BehaviorFlagDto.REPEATED_WRONG_PATTERNS);
    }
    if (
      (summary.totalInactivityMs ?? 0) > 30000 ||
      (summary.distractionMoments ?? 0) >= 3 ||
      (attention?.facePresenceRatio ?? 1) < 0.6
    ) {
      derived.push(BehaviorFlagDto.LOW_ENGAGEMENT);
    }
    const pacingThreshold = canAssessLateDrift ? 0.65 : 0.85;
    if ((summary.paceVariability ?? 0) > pacingThreshold) {
      derived.push(BehaviorFlagDto.INCONSISTENT_PACING);
    }
    if (
      canAssessLateDrift &&
      ((summary.lateSessionSlowdownRatio ?? 1) > 1.85 ||
        (summary.lateSessionAccuracyDrop ?? 0) > 0.45)
    ) {
      derived.push(BehaviorFlagDto.FATIGUE_SIGNALS);
    }
    return derived;
  }

  private _generateServerFeedback(
    flags: BehaviorFlagDto[],
    engagement: number,
    reliability: number,
  ): Record<string, string[]> {
    const strengths: string[] = [];
    const observations: string[] = [];
    const recommendations: string[] = [];

    if (engagement >= 75)
      strengths.push('Bon niveau de concentration détecté.');
    if (reliability >= 80)
      strengths.push('Les réponses semblent délibérées et fiables.');
    if (flags.length === 0)
      strengths.push('Aucun comportement suspect détecté.');

    if (flags.includes(BehaviorFlagDto.FAST_ANSWERS)) {
      observations.push('Plusieurs réponses ont été soumises trop rapidement.');
      recommendations.push('Prenez plus de temps pour lire chaque question.');
    }
    if (flags.includes(BehaviorFlagDto.FREQUENT_APP_SWITCHING)) {
      observations.push('Des interruptions de session ont été détectées.');
      recommendations.push("Évitez de changer d'application pendant le quiz.");
    }
    if (flags.includes(BehaviorFlagDto.RANDOM_PATTERNS)) {
      recommendations.push('Faites confiance à votre première intuition.');
    }
    if (flags.includes(BehaviorFlagDto.INCONSISTENT_PACING)) {
      observations.push(
        'Le rythme de réponse varie fortement selon les questions.',
      );
      recommendations.push(
        'Maintenez un rythme stable: lire, réfléchir, puis répondre.',
      );
    }
    if (flags.includes(BehaviorFlagDto.FATIGUE_SIGNALS)) {
      observations.push(
        'Des signes de fatigue apparaissent en fin de session.',
      );
      recommendations.push(
        'Prévoyez des pauses courtes avant les sessions longues.',
      );
    }
    if (engagement < 50) {
      recommendations.push(
        'Cherchez un environnement calme pour vos prochains quiz.',
      );
    }

    return { strengths, observations, recommendations };
  }

  // ── Gemini Vision gaze analysis ──────────────────────────────────────────

  /**
   * Receives a JPEG image (base64) from the Flutter app and asks
   * Gemini Vision whether the user is looking at the phone screen.
   * The GEMINI_API_KEY lives in the server environment (Render), never
   * in the mobile binary.
   */
  async analyzeGaze(
    imageBase64: string,
    mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  ): Promise<{ gazeOnScreen: boolean; raw: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Graceful degradation — no key configured yet.
      return { gazeOnScreen: true, raw: 'NO_KEY' };
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
        'Look at this selfie camera frame taken from a smartphone during a training quiz. ' +
          'Is the person in the image currently looking directly at the phone screen? ' +
          'Answer with exactly one word: YES or NO.',
      ]);

      const raw = (result.response.text() ?? '').trim().toUpperCase();
      return { gazeOnScreen: raw.startsWith('YES'), raw };
    } catch {
      // Never crash the quiz flow — return a neutral result.
      console.warn(
        '[GazeAnalysis] Gemini unavailable, returning neutral gaze.',
      );
      return { gazeOnScreen: true, raw: 'ERROR' };
    }
  }
}
