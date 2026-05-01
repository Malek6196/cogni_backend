import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  ProgressContextService,
  ProgressContext,
} from './progress-context.service';
import {
  RecommendationFeedback,
  RecommendationFeedbackDocument,
} from './schemas/recommendation-feedback.schema';
import {
  ParentFeedbackRequest,
  ParentFeedbackRequestDocument,
} from './schemas/parent-feedback-request.schema';
import {
  ParentFeedback,
  ParentFeedbackDocument,
} from './schemas/parent-feedback.schema';
import { Child, ChildDocument } from '../children/schemas/child.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organization/schemas/organization.schema';
import {
  SpecializedPlan,
  SpecializedPlanDocument,
} from '../specialized-plans/schemas/specialized-plan.schema';
import { LlmService, LlmPreferences, LlmRecommendation } from './llm.service';
import {
  TaskReminder,
  TaskReminderDocument,
} from '../nutrition/schemas/task-reminder.schema';
import { RemindersService } from '../nutrition/reminders.service';
import { SpecializedPlansService } from '../specialized-plans/specialized-plans.service';

export interface AdminSummary {
  planCountByType: Record<string, number>;
  totalPlans: number;
  childrenWithPlansCount: number;
}

export interface OrgSpecialistSummary {
  specialistId: string;
  planCountByType: Record<string, number>;
  totalPlans: number;
  childrenCount: number;
  insight?: string;
  /** Feedback aggregates (non-PII) */
  totalFeedback?: number;
  approvedCount?: number;
  modifiedCount?: number;
  dismissedCount?: number;
  resultsImprovedTrueCount?: number;
  resultsImprovedFalseCount?: number;
  approvalRatePercent?: number;
  resultsImprovedRatePercent?: number;
}

export interface RecommendationResult extends LlmRecommendation {
  recommendationId: string;
}

@Injectable()
export class ProgressAiService {
  private readonly logger = new Logger(ProgressAiService.name);

  constructor(
    private progressContextService: ProgressContextService,
    @InjectModel(RecommendationFeedback.name)
    private recommendationFeedbackModel: Model<RecommendationFeedbackDocument>,
    @InjectModel(Child.name) private childModel: Model<ChildDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Organization.name)
    private organizationModel: Model<OrganizationDocument>,
    @InjectModel(SpecializedPlan.name)
    private planModel: Model<SpecializedPlanDocument>,
    @InjectModel(ParentFeedbackRequest.name)
    private parentFeedbackRequestModel: Model<ParentFeedbackRequestDocument>,
    @InjectModel(ParentFeedback.name)
    private parentFeedbackModel: Model<ParentFeedbackDocument>,
    @InjectModel(TaskReminder.name)
    private taskReminderModel: Model<TaskReminderDocument>,
    private remindersService: RemindersService,
    private specializedPlansService: SpecializedPlansService,
    private llmService: LlmService,
  ) {}

  async verifySpecialistOrOrgAccessToChild(
    childId: string,
    userId: string,
    userRole: string,
  ): Promise<void> {
    const child = await this.childModel.findById(childId).lean().exec();
    if (!child) throw new NotFoundException('Child not found');

    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) throw new ForbiddenException('User not found');

    const specialistRoles = [
      'psychologist',
      'speech_therapist',
      'occupational_therapist',
      'doctor',
      'volunteer',
      'other',
    ];
    const isSpecialist = specialistRoles.includes(userRole);
    const isOrgLeader = userRole === 'organization_leader';
    const isAssignedSpecialist = child.specialistId?.toString() === userId;
    const isChildInUserOrg =
      isOrgLeader &&
      user.organizationId &&
      child.organizationId?.toString() === user.organizationId.toString();

    if (isSpecialist && !isAssignedSpecialist) {
      if (!isChildInUserOrg && child.organizationId) {
        const org = await this.organizationModel
          .findById(child.organizationId)
          .lean()
          .exec();
        if (!org || org._id.toString() !== user.organizationId?.toString()) {
          throw new ForbiddenException('Not authorized to access this child');
        }
      }
    } else if (isOrgLeader && !isChildInUserOrg) {
      throw new ForbiddenException('Not authorized to access this child');
    } else if (!isSpecialist && !isOrgLeader) {
      throw new ForbiddenException('Not authorized to access this child');
    }
  }

  async getRecommendations(
    childId: string,
    orgId: string | undefined,
    userId: string,
    userRole: string,
    options?: { planType?: string; preferences?: LlmPreferences },
  ): Promise<RecommendationResult> {
    if (
      !childId ||
      typeof childId !== 'string' ||
      !/^[a-fA-F0-9]{24}$/.test(childId)
    ) {
      throw new BadRequestException('Invalid child ID');
    }
    try {
      await this.verifySpecialistOrOrgAccessToChild(childId, userId, userRole);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException)
        throw e;
      this.logger.warn(
        `verifySpecialistOrOrgAccessToChild failed for childId=${childId} userId=${userId}: ${(e as Error)?.message}`,
      );
      return this.fallbackRecommendationResult();
    }
    const specialistRoles = [
      'psychologist',
      'speech_therapist',
      'occupational_therapist',
      'doctor',
      'volunteer',
      'other',
    ];
    let prefs = options?.preferences;
    if (specialistRoles.includes(userRole)) {
      const user = await this.userModel.findById(userId).lean().exec();

      const stored = (user as any)?.specialistAIPreferences;
      if (stored) {
        prefs = {
          focusPlanTypes: stored.focusPlanTypes ?? prefs?.focusPlanTypes,
          summaryLength: stored.summaryLength ?? prefs?.summaryLength,
          planTypeWeights: stored.planTypeWeights ?? prefs?.planTypeWeights,
        };
      }
    }
    let context: ProgressContext;
    try {
      context = await this.progressContextService.buildContext(childId, orgId);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException)
        throw e;
      this.logger.warn(
        `buildContext failed for childId=${childId} userId=${userId}: ${(e as Error)?.message}`,
      );
      return this.fallbackRecommendationResult();
    }
    const planTypeFilter = options?.planType;
    let contextForPrompt = context;
    if (planTypeFilter) {
      contextForPrompt = {
        ...context,
        plans: context.plans.filter(
          (p: { type?: string }) => p.type === planTypeFilter,
        ),
      };
    }
    let llmResult: LlmRecommendation;
    try {
      llmResult = await this.llmService.generateRecommendations(
        contextForPrompt,
        prefs,
      );
    } catch (e) {
      this.logger.warn(
        `LLM generateRecommendations failed childId=${childId} userId=${userId}: ${(e as Error)?.message}`,
      );
      return this.fallbackRecommendationResult();
    }
    const recommendationId = crypto.randomUUID();
    return {
      recommendationId,
      summary: llmResult.summary,
      recommendations: planTypeFilter
        ? llmResult.recommendations.filter((r) => r.planType === planTypeFilter)
        : llmResult.recommendations,
      milestones: llmResult.milestones,
      predictions: llmResult.predictions,
    };
  }

  private fallbackRecommendationResult(): RecommendationResult {
    return {
      recommendationId: crypto.randomUUID(),
      summary:
        'Recommandations temporairement indisponibles. Vérifiez que le service IA (GEMINI_API_KEY) est configuré et que le contexte enfant est accessible.',
      recommendations: [],
      milestones: undefined,
      predictions: undefined,
    };
  }

  async submitFeedback(
    recommendationId: string,
    payload: {
      childId: string;
      planId?: string;
      action: 'approved' | 'modified' | 'dismissed';
      editedText?: string;
      originalRecommendationText?: string;
      planType?: string;
      resultsImproved?: boolean;
      parentFeedbackHelpful?: boolean;
    },
    specialistId: string,
  ): Promise<RecommendationFeedback> {
    const doc = new this.recommendationFeedbackModel({
      childId: new Types.ObjectId(payload.childId),
      planId: payload.planId ? new Types.ObjectId(payload.planId) : undefined,
      planType: payload.planType,
      recommendationId,
      action: payload.action,
      editedText: payload.editedText,
      specialistId: new Types.ObjectId(specialistId),
      originalRecommendationText: payload.originalRecommendationText,
      resultsImproved: payload.resultsImproved,
      parentFeedbackHelpful: payload.parentFeedbackHelpful,
    });
    return await doc.save();
  }

  async getAdminSummary(): Promise<AdminSummary> {
    const plans = await this.planModel
      .find({ status: 'active' })
      .select('type childId')
      .lean()
      .exec();
    const planCountByType: Record<string, number> = {
      PECS: 0,
      TEACCH: 0,
      SkillTracker: 0,
      Activity: 0,
    };
    const childIds = new Set<string>();
    for (const p of plans as Array<{
      type?: string;
      childId?: { toString(): string };
    }>) {
      const t = p.type;
      if (t && planCountByType[t] !== undefined) planCountByType[t]++;
      childIds.add(p.childId?.toString() ?? '');
    }
    return {
      planCountByType,
      totalPlans: plans.length,
      childrenWithPlansCount: childIds.has('')
        ? childIds.size - 1
        : childIds.size,
    };
  }

  /**
   * Admin: same aggregate structure per organization (no PII). For broader scope view.
   */
  async getAdminSummaryByOrg(): Promise<
    Array<{
      orgId: string;
      planCountByType: Record<string, number>;
      totalPlans: number;
      childrenWithPlansCount: number;
    }>
  > {
    const plans = await this.planModel
      .find({ status: 'active' })
      .select('type childId organizationId')
      .lean()
      .exec();
    const byOrg = new Map<
      string,
      {
        planCountByType: Record<string, number>;
        childIds: Set<string>;
        count: number;
      }
    >();
    const types = ['PECS', 'TEACCH', 'SkillTracker', 'Activity'] as const;
    for (const p of plans) {
      const orgId =
        (
          p as { organizationId?: { toString(): string } }
        ).organizationId?.toString() ?? '_no_org';
      if (!byOrg.has(orgId)) {
        byOrg.set(orgId, {
          planCountByType: { PECS: 0, TEACCH: 0, SkillTracker: 0, Activity: 0 },
          childIds: new Set(),
          count: 0,
        });
      }
      const entry = byOrg.get(orgId)!;
      const t = (
        p as { type?: 'PECS' | 'TEACCH' | 'SkillTracker' | 'Activity' }
      ).type;
      if (t && types.includes(t)) entry.planCountByType[t]++;
      entry.count++;
      entry.childIds.add(
        (p as { childId?: { toString(): string } }).childId?.toString() ?? '',
      );
    }
    return Array.from(byOrg.entries()).map(([orgId, data]) => ({
      orgId: orgId === '_no_org' ? '' : orgId,
      planCountByType: data.planCountByType,
      totalPlans: data.count,
      childrenWithPlansCount: data.childIds.has('')
        ? data.childIds.size - 1
        : data.childIds.size,
    }));
  }

  async getOrgSpecialistSummary(
    specialistId: string,
    orgLeaderUserId: string,
  ): Promise<OrgSpecialistSummary> {
    const org = await this.organizationModel
      .findOne({ leaderId: new Types.ObjectId(orgLeaderUserId) })
      .lean()
      .exec();
    if (!org) throw new ForbiddenException('Organization not found');
    const specialist = await this.userModel
      .findById(specialistId)
      .lean()
      .exec();
    if (!specialist) throw new NotFoundException('Specialist not found');
    if (
      (
        specialist as unknown as { organizationId?: { toString(): string } }
      ).organizationId?.toString() !==
      (org as unknown as { _id?: { toString(): string } })._id?.toString()
    ) {
      throw new ForbiddenException('Specialist is not in your organization');
    }
    const plans = await this.planModel
      .find({
        specialistId: new Types.ObjectId(specialistId),
        status: 'active',
      })
      .select('type childId')
      .lean()
      .exec();
    const planCountByType: Record<string, number> = {
      PECS: 0,
      TEACCH: 0,
      SkillTracker: 0,
      Activity: 0,
    };
    const childIds = new Set<string>();
    for (const p of plans) {
      const t = (p as { type?: string }).type;
      if (t && planCountByType[t] !== undefined) planCountByType[t]++;
      childIds.add(
        (p as { childId?: { toString(): string } }).childId?.toString() ?? '',
      );
    }
    const childrenCount = childIds.has('') ? childIds.size - 1 : childIds.size;

    const feedbackList = await this.recommendationFeedbackModel
      .find({ specialistId: new Types.ObjectId(specialistId) })
      .select('action resultsImproved')
      .lean()
      .exec();
    let approvedCount = 0;
    let modifiedCount = 0;
    let dismissedCount = 0;
    let resultsImprovedTrue = 0;
    let resultsImprovedFalse = 0;
    for (const f of feedbackList) {
      const a = (f as { action?: string }).action;
      if (a === 'approved') approvedCount++;
      else if (a === 'modified') modifiedCount++;
      else if (a === 'dismissed') dismissedCount++;
      const ri = (f as { resultsImproved?: boolean }).resultsImproved;
      if (ri === true) resultsImprovedTrue++;
      else if (ri === false) resultsImprovedFalse++;
    }
    const totalFeedback = feedbackList.length;
    const approvalRatePercent =
      totalFeedback > 0
        ? Math.round((approvedCount / totalFeedback) * 100)
        : undefined;
    const resultsWithImproved = resultsImprovedTrue + resultsImprovedFalse;
    const resultsImprovedRatePercent =
      resultsWithImproved > 0
        ? Math.round((resultsImprovedTrue / resultsWithImproved) * 100)
        : undefined;

    return {
      specialistId,
      planCountByType,
      totalPlans: plans.length,
      childrenCount,
      totalFeedback,
      approvedCount,
      modifiedCount,
      dismissedCount,
      resultsImprovedTrueCount: resultsImprovedTrue,
      resultsImprovedFalseCount: resultsImprovedFalse,
      approvalRatePercent,
      resultsImprovedRatePercent,
    };
  }

  /**
   * Returns 2–3 activity suggestions for the specialist dashboard (static tips).
   */
  getActivitySuggestions(_specialistId: string): { suggestions: string[] } {
    return {
      suggestions: [
        "Augmenter les choix d'images pour les cartes PECS en phase 2.",
        'Travailler les objectifs sociaux dans les plans TEACCH cette semaine.',
        'Consulter les retours parents dans les recommandations IA pour ajuster les activités.',
      ],
    };
  }

  async updateSpecialistPreferences(
    userId: string,
    prefs: {
      focusPlanTypes?: string[];
      summaryLength?: 'short' | 'detailed';
      frequency?: 'every_session' | 'weekly';
      planTypeWeights?: Record<string, number>;
    },
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    (user as any).specialistAIPreferences = {
      ...((user as any).specialistAIPreferences ?? {}),
      ...prefs,
    };
    await user.save();
  }

  async getSpecialistPreferences(userId: string): Promise<{
    focusPlanTypes?: string[];
    summaryLength?: 'short' | 'detailed';
    frequency?: 'every_session' | 'weekly';
    planTypeWeights?: Record<string, number>;
  } | null> {
    const user = await this.userModel
      .findById(userId)
      .select('specialistAIPreferences')
      .lean()
      .exec();
    return (
      (user as { specialistAIPreferences?: Record<string, unknown> })
        ?.specialistAIPreferences ?? null
    );
  }

  async requestParentFeedback(
    childId: string,
    specialistId: string,
    specialistRole: string,
    payload: { recommendationId?: string; message?: string; planType?: string },
  ): Promise<ParentFeedbackRequest> {
    await this.verifySpecialistOrOrgAccessToChild(
      childId,
      specialistId,
      specialistRole,
    );
    const doc = new this.parentFeedbackRequestModel({
      childId: new Types.ObjectId(childId),
      specialistId: new Types.ObjectId(specialistId),
      recommendationId: payload.recommendationId,
      planType: payload.planType,
      message: payload.message,
      status: 'pending',
    });
    return await doc.save();
  }

  /**
   * Submit parent feedback (rating + comment) for a child.
   * Verifies child.parentId === parentUserId.
   */
  async submitParentFeedback(
    childId: string,
    parentUserId: string,
    payload: { rating: number; comment?: string; planType?: string },
  ): Promise<ParentFeedback> {
    const child = await this.childModel.findById(childId).lean().exec();
    if (!child) throw new NotFoundException('Child not found');

    const childParentId = (child as { parentId?: { toString(): string } }).parentId?.toString();
    
    // Log for debugging
    this.logger.log(`Parent feedback attempt - childId: ${childId}, childParentId: ${childParentId}, parentUserId: ${parentUserId}`);

    if (childParentId !== parentUserId) {
      this.logger.warn(
        `Unauthorized feedback attempt: child parentId (${childParentId}) does not match requesting user (${parentUserId})`,
      );
      throw new ForbiddenException(
        'Not authorized to submit feedback for this child',
      );
    }

    const doc = new this.parentFeedbackModel({
      childId: new Types.ObjectId(childId),
      parentId: new Types.ObjectId(parentUserId),
      rating: payload.rating,
      comment: payload.comment,
      planType: payload.planType,
    });
    
    try {
      const saved = await doc.save();
      this.logger.log(`Parent feedback saved successfully for child ${childId}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to save parent feedback: ${error}`);
      throw error;
    }
  }

  /**
   * Get recent parent feedback for a child (for display in parent UI).
   * Verifies child.parentId === parentUserId.
   */
  async getParentFeedback(
    childId: string,
    parentUserId: string,
    limit: number = 10,
  ): Promise<ParentFeedback[]> {
    const child = await this.childModel.findById(childId).lean().exec();
    if (!child) throw new NotFoundException('Child not found');
    if (
      (child as { parentId?: { toString(): string } }).parentId?.toString() !==
      parentUserId
    ) {
      throw new ForbiddenException(
        'Not authorized to view feedback for this child',
      );
    }
    return (await this.parentFeedbackModel
      .find({
        childId: new Types.ObjectId(childId),
        parentId: new Types.ObjectId(parentUserId),
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec()) as ParentFeedback[];
  }

  /**
   * Delete a parent feedback entry.
   * Verifies child.parentId === parentUserId and feedback belongs to the parent.
   */
  async deleteParentFeedback(
    childId: string,
    feedbackId: string,
    parentUserId: string,
  ): Promise<void> {
    const child = await this.childModel.findById(childId).lean().exec();
    if (!child) throw new NotFoundException('Child not found');

    const childParentId = (child as { parentId?: { toString(): string } }).parentId?.toString();
    if (childParentId !== parentUserId) {
      throw new ForbiddenException(
        'Not authorized to delete feedback for this child',
      );
    }

    const feedback = await this.parentFeedbackModel.findById(feedbackId).lean().exec();
    if (!feedback) throw new NotFoundException('Feedback not found');

    if ((feedback as { parentId?: Types.ObjectId }).parentId?.toString() !== parentUserId) {
      throw new ForbiddenException(
        'Not authorized to delete this feedback',
      );
    }

    await this.parentFeedbackModel.findByIdAndDelete(feedbackId).exec();
    this.logger.log(`Parent feedback deleted: ${feedbackId}`);
  }

  /**
   * Update a parent feedback entry.
   * Verifies child.parentId === parentUserId and feedback belongs to the parent.
   */
  async updateParentFeedback(
    childId: string,
    feedbackId: string,
    parentUserId: string,
    payload: { rating: number; comment?: string; planType?: string },
  ): Promise<ParentFeedback> {
    const child = await this.childModel.findById(childId).lean().exec();
    if (!child) throw new NotFoundException('Child not found');

    const childParentId = (child as { parentId?: { toString(): string } }).parentId?.toString();
    if (childParentId !== parentUserId) {
      throw new ForbiddenException(
        'Not authorized to update feedback for this child',
      );
    }

    const feedback = await this.parentFeedbackModel.findById(feedbackId).exec();
    if (!feedback) throw new NotFoundException('Feedback not found');

    if ((feedback as { parentId?: Types.ObjectId }).parentId?.toString() !== parentUserId) {
      throw new ForbiddenException(
        'Not authorized to update this feedback',
      );
    }

    feedback.rating = payload.rating;
    if (payload.comment !== undefined) feedback.comment = payload.comment;
    if (payload.planType !== undefined) feedback.planType = payload.planType;
    
    const updated = await feedback.save();
    this.logger.log(`Parent feedback updated: ${feedbackId}`);
    return updated;
  }

  /**
   * Parent-facing AI summary for a child (week or month). Verifies child.parentId === parentUserId.
   */
  async getParentSummary(
    childId: string,
    parentUserId: string,
    period: 'week' | 'month',
  ): Promise<{ summary: string }> {
    const child = await this.childModel.findById(childId).lean().exec();
    if (!child) throw new NotFoundException('Child not found');
    if (
      (child as { parentId?: { toString(): string } }).parentId?.toString() !==
      parentUserId
    ) {
      throw new ForbiddenException('Not authorized to view this child');
    }
    const days = period === 'week' ? 7 : 30;
    const stats = (await this.remindersService.getCompletionStats(
      childId,
      parentUserId,
      days,
    )) as {
      totalTasks: number;
      completedTasks: number;
      completionRate: number;
    };
    const planProgress =
      await this.specializedPlansService.getProgressSummaryForParent(
        childId,
        parentUserId,
      );
    const reminders = await this.taskReminderModel
      .find({ childId: new Types.ObjectId(childId), isActive: true })
      .select('completionHistory')
      .lean()
      .exec();
    const recentFeedbackSnippets: string[] = [];
    for (const r of reminders) {
      const history =
        (r as { completionHistory?: Array<{ feedback?: unknown }> })
          .completionHistory ?? [];
      for (const h of history) {
        if (typeof h.feedback === 'string' && h.feedback.trim().length > 0) {
          recentFeedbackSnippets.push(String(h.feedback).trim().slice(0, 150));
        }
      }
    }
    recentFeedbackSnippets.reverse();
    const snippets = recentFeedbackSnippets.slice(0, 5);

    const ageYears = child.dateOfBirth
      ? Math.max(
          0,
          new Date().getFullYear() - new Date(child.dateOfBirth).getFullYear(),
        )
      : 0;
    const summary = await this.llmService.generateParentSummary(period, {
      childAgeYears: ageYears,
      diagnosis: child.diagnosis,
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      completionRate: stats.completionRate,
      planProgress: planProgress.map((p) => ({
        type: p.type,
        title: p.title,
        progressPercent: p.progressPercent,
      })),
      recentFeedbackSnippets: snippets,
    });
    return { summary };
  }
}
