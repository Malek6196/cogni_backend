import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { CertificationTest } from './schemas/certification-test.schema';
import { CertificationAttempt } from './schemas/certification-attempt.schema';
import { VolunteersService } from '../volunteers/volunteers.service';
import { CoursesService } from '../courses/courses.service';

export interface QuestionForClient {
  index: number;
  type: 'mcq' | 'short_answer';
  text: string;
  options?: string[];
}

interface SubmitAnswerDto {
  questionIndex: number;
  value: string;
}

@Injectable()
export class CertificationTestService {
  private readonly logger = new Logger(CertificationTestService.name);
  private readonly geminiKey = process.env.GEMINI_API_KEY;
  private readonly geminiModel =
    process.env.PROGRESS_AI_MODEL?.trim() || 'gemini-2.0-flash';

  constructor(
    @InjectModel(CertificationTest.name)
    private readonly testModel: Model<CertificationTest>,
    @InjectModel(CertificationAttempt.name)
    private readonly attemptModel: Model<CertificationAttempt>,
    private readonly volunteersService: VolunteersService,
    private readonly coursesService: CoursesService,
  ) {}

  /**
   * Returns the certification test for the volunteer (questions without correct answers).
   * Requires: completed qualification course and approved application.
   * If already certified, returns { alreadyCertified: true }.
   */
  async getTest(userId: string): Promise<{
    alreadyCertified?: boolean;
    testId?: string;
    title?: string;
    questions?: QuestionForClient[];
    passingScorePercent?: number;
  }> {
    const app = await this.volunteersService.getOrCreateApplication(userId);
    const application = app;
    if (application?.trainingCertified === true) {
      return { alreadyCertified: true };
    }
    if (application?.status !== 'approved') {
      throw new BadRequestException(
        'Your volunteer application must be approved before taking the certification test.',
      );
    }
    const completed =
      await this.coursesService.hasCompletedQualificationCourse(userId);
    if (!completed) {
      throw new BadRequestException(
        'Complete a qualification course (100%) before taking the certification test.',
      );
    }

    const test = await this.testModel.findOne({ slug: 'default' }).exec();
    if (!test || !test.questions?.length) {
      throw new NotFoundException(
        'Certification test is not available. Please contact support.',
      );
    }

    const questions: QuestionForClient[] = test.questions.map((q, index) => {
      const out: QuestionForClient = {
        index,
        type: q.type,
        text: q.text,
      };
      if (q.type === 'mcq' && q.options?.length) {
        out.options = [...q.options];
      }
      return out;
    });

    return {
      testId: (test as unknown as { _id: Types.ObjectId })._id?.toString?.(),
      title: test.title,
      questions,
      passingScorePercent: test.passingScorePercent,
    };
  }

  /**
   * Submit answers, compute score, and if passed call completeCertification.
   */
  async submit(
    userId: string,
    answers: SubmitAnswerDto[],
  ): Promise<{
    passed: boolean;
    scorePercent: number;
    certified: boolean;
    totalQuestions: number;
    correctCount: number;
  }> {
    const test = await this.testModel.findOne({ slug: 'default' }).exec();
    if (!test || !test.questions?.length) {
      throw new NotFoundException('Certification test not found.');
    }

    const app = await this.volunteersService.getOrCreateApplication(userId);
    const application = app;
    if (application?.trainingCertified === true) {
      return {
        passed: true,
        scorePercent: 100,
        certified: true,
        totalQuestions: test.questions.length,
        correctCount: test.questions.length,
      };
    }

    let correctCount = 0;
    const answerMap = new Map(
      answers.map((a) => [a.questionIndex, a.value?.trim() ?? '']),
    );

    for (let i = 0; i < test.questions.length; i++) {
      const q = test.questions[i];
      const userValue = answerMap.get(i) ?? '';
      if (q.type === 'mcq') {
        const correctIndex = q.correctOptionIndex ?? -1;
        const option = q.options?.[correctIndex];
        if (option !== undefined && userValue === option) {
          correctCount++;
        }
      } else {
        const expected = (q.correctAnswer ?? '').trim().toLowerCase();
        const actual = userValue.toLowerCase().trim();
        if (expected && actual && actual === expected) {
          correctCount++;
        }
      }
    }

    const totalQuestions = test.questions.length;
    const scorePercent =
      totalQuestions > 0
        ? Math.round((correctCount / totalQuestions) * 100)
        : 0;
    const passed = scorePercent >= (test.passingScorePercent ?? 80);

    await this.attemptModel.create({
      userId: new Types.ObjectId(userId),
      testId: (test as unknown as { _id: Types.ObjectId })._id,
      answers: answers.map((a) => ({
        questionIndex: a.questionIndex,
        value: a.value,
      })),
      scorePercent,
      passed,
      certified: false,
    });

    let certified = false;
    if (passed) {
      await this.volunteersService.completeCertification(userId);
      certified = true;
      const attempt = await this.attemptModel
        .findOne({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .exec();
      if (attempt) {
        attempt.certified = true;
        await attempt.save();
      }
    }

    return {
      passed,
      scorePercent,
      certified,
      totalQuestions,
      correctCount,
    };
  }

  /**
   * AI-generated insights and recommendations for the volunteer (performance, next steps).
   */
  async getVolunteerInsights(userId: string): Promise<{
    summary: string;
    recommendations: string[];
    scorePercent?: number;
    completedCoursesCount?: number;
    isCertified?: boolean;
    lastTestPassed?: boolean;
  }> {
    const [app, enrollments, lastAttempt, allAttempts] = await Promise.all([
      this.volunteersService.getOrCreateApplication(userId),
      this.coursesService.myEnrollments(userId),
      this.attemptModel
        .findOne({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.attemptModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
        .exec(),
    ]);

    const application = app;
    const isCertified = application?.trainingCertified === true;
    const allEnrollments = enrollments as Array<Record<string, unknown>>;

    const completedEnrollments = allEnrollments.filter(
      (e) => e.status === 'completed' && (e.progressPercent as number) >= 100,
    );
    const inProgressEnrollments = allEnrollments.filter(
      (e) => e.status !== 'completed' && (e.progressPercent as number) > 0,
    );
    const qualificationCompleted = completedEnrollments.some(
      (e) =>
        (e.course as Record<string, unknown>)?.isQualificationCourse === true,
    );

    const lastAttemptData = lastAttempt as Record<string, unknown> | null;
    const attemptsData = allAttempts as Array<Record<string, unknown>>;
    const attemptCount = attemptsData.length;
    const bestScore = attemptsData.reduce((best, a) => {
      const s = (a.scorePercent as number) ?? 0;
      return s > best ? s : best;
    }, 0);
    const lastScore = (lastAttemptData?.scorePercent as number) ?? null;
    const lastPassed = lastAttemptData?.passed === true;

    // Compute overall progress percent across all enrollments
    const avgProgress =
      allEnrollments.length > 0
        ? Math.round(
            allEnrollments.reduce(
              (sum, e) => sum + ((e.progressPercent as number) ?? 0),
              0,
            ) / allEnrollments.length,
          )
        : 0;

    const context = {
      applicationStatus: application?.status,
      isCertified,
      completedCoursesCount: completedEnrollments.length,
      inProgressCoursesCount: inProgressEnrollments.length,
      totalEnrolledCourses: allEnrollments.length,
      qualificationCourseCompleted: qualificationCompleted,
      averageProgressPercent: avgProgress,
      certificationAttempts: attemptCount,
      lastTestScore: lastScore,
      bestTestScore: bestScore > 0 ? bestScore : null,
      lastTestPassed: lastPassed,
    };

    // --- Smart fallback (no Gemini key) ---
    if (!this.geminiKey) {
      return {
        ...this._buildSmartFallback(context),
        scorePercent: lastScore ?? undefined,
        completedCoursesCount: completedEnrollments.length,
        isCertified,
        lastTestPassed: lastPassed,
      };
    }

    // --- Gemini AI ---
    const prompt = `Tu es un coach bienveillant pour une plateforme de bénévoles accompagnant des enfants autistes (TSA).
Voici le profil anonymisé d'un bénévole (JSON):
${JSON.stringify(context, null, 2)}

Génère une analyse personnalisée. Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de \`\`\`):
{
  "summary": "2-3 phrases encourageantes et précises sur son parcours actuel, ses forces et son prochain objectif clé",
  "recommendations": ["action concrète 1", "action concrète 2", "action concrète 3"],
  "strengths": ["point fort 1", "point fort 2"],
  "nextMilestone": "description courte du prochain jalon important"
}

Règles:
- Sois précis et utilise les données (scores, nombre de cours, progression)
- Recommandations actionnables et motivantes
- Langue: français
- Si certifié: félicite et oriente vers les missions et formations avancées
- Si score test < 80%: encourage à réviser les points faibles
- Si aucune formation commencée: guide vers le premier pas`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent`;
      const res = await axios.post<{
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      }>(
        url,
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        },
        {
          params: { key: this.geminiKey },
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const text =
        res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      const cleaned = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      const summary =
        typeof parsed.summary === 'string'
          ? parsed.summary
          : this._buildSmartFallback(context).summary;

      const recommendations = Array.isArray(parsed.recommendations)
        ? (parsed.recommendations as unknown[])
            .filter((r): r is string => typeof r === 'string')
            .slice(0, 4)
        : this._buildSmartFallback(context).recommendations;

      const strengths = Array.isArray(parsed.strengths)
        ? (parsed.strengths as unknown[])
            .filter((s): s is string => typeof s === 'string')
            .slice(0, 3)
        : [];

      const nextMilestone =
        typeof parsed.nextMilestone === 'string' ? parsed.nextMilestone : null;

      return {
        summary,
        recommendations,
        ...(strengths.length > 0 && { strengths }),
        ...(nextMilestone && { nextMilestone }),
        scorePercent: lastScore ?? undefined,
        completedCoursesCount: completedEnrollments.length,
        isCertified,
        lastTestPassed: lastPassed,
      };
    } catch (err) {
      this.logger.warn(
        'Gemini volunteer insights failed: ' + (err as Error)?.message,
      );
      return {
        ...this._buildSmartFallback(context),
        scorePercent: lastScore ?? undefined,
        completedCoursesCount: completedEnrollments.length,
        isCertified,
        lastTestPassed: lastPassed,
      };
    }
  }

  private _buildSmartFallback(context: {
    isCertified: boolean;
    qualificationCourseCompleted: boolean;
    completedCoursesCount: number;
    inProgressCoursesCount: number;
    totalEnrolledCourses: number;
    averageProgressPercent: number;
    certificationAttempts: number;
    lastTestScore: number | null;
    bestTestScore: number | null;
    lastTestPassed: boolean;
  }): { summary: string; recommendations: string[] } {
    const {
      isCertified,
      qualificationCourseCompleted,
      completedCoursesCount,
      inProgressCoursesCount,
      totalEnrolledCourses,
      averageProgressPercent,
      certificationAttempts,
      lastTestScore,
      bestTestScore,
      lastTestPassed,
    } = context;

    if (isCertified) {
      return {
        summary: `Félicitations ! Vous êtes certifié avec ${completedCoursesCount} formation${completedCoursesCount > 1 ? 's' : ''} complétée${completedCoursesCount > 1 ? 's' : ''}. Vous êtes prêt à accompagner des familles et à accepter des missions.`,
        recommendations: [
          "Consultez l'Agenda pour accepter vos premières missions",
          'Explorez les formations avancées pour approfondir vos compétences',
          'Partagez votre expérience dans la section Communauté',
          'Téléchargez votre certificat et partagez votre réussite',
        ],
      };
    }

    if (qualificationCourseCompleted) {
      const scoreHint =
        certificationAttempts > 0 && lastTestScore !== null
          ? ` Votre dernier score : ${lastTestScore}%.${lastTestScore < 80 ? ' Révisez les points faibles avant de réessayer.' : ' Vous êtes proche !'}`
          : '';
      return {
        summary: `Excellent travail ! Vous avez terminé la formation qualifiante.${scoreHint} Passez le test de certification pour débloquer l'Agenda et les Messages.`,
        recommendations: [
          certificationAttempts > 0
            ? `Réessayez le test (meilleur score : ${bestTestScore ?? 0}%)`
            : 'Passez le test de certification',
          'Révisez les modules clés : méthode TEACCH, communication PECS',
          'Lisez les ressources supplémentaires dans le catalogue',
        ],
      };
    }

    if (inProgressCoursesCount > 0) {
      return {
        summary: `Vous progressez bien ! ${completedCoursesCount} formation${completedCoursesCount > 1 ? 's' : ''} terminée${completedCoursesCount > 1 ? 's' : ''}, ${inProgressCoursesCount} en cours (progression moyenne : ${averageProgressPercent}%). Continuez pour atteindre la certification.`,
        recommendations: [
          'Terminez la formation qualifiante pour accéder au test',
          'Consacrez 15-20 minutes par jour à votre formation',
          'Prenez des notes sur les concepts clés (TEACCH, PECS)',
          completedCoursesCount > 0
            ? `Bravo pour vos ${completedCoursesCount} formation${completedCoursesCount > 1 ? 's' : ''} complétée${completedCoursesCount > 1 ? 's' : ''} !`
            : 'Explorez le catalogue pour trouver la formation qui vous convient',
        ],
      };
    }

    if (totalEnrolledCourses > 0) {
      return {
        summary: `Vous avez commencé votre parcours avec ${totalEnrolledCourses} formation${totalEnrolledCourses > 1 ? 's' : ''} inscrite${totalEnrolledCourses > 1 ? 's' : ''}. Reprenez là où vous vous êtes arrêté pour progresser vers la certification.`,
        recommendations: [
          'Reprenez votre formation en cours',
          "Fixez-vous un objectif : terminer un module aujourd'hui",
          'Rejoignez la communauté pour échanger avec d\'autres bénévoles',
        ],
      };
    }

    return {
      summary:
        "Bienvenue ! Commencez votre parcours de formation pour devenir un accompagnant certifié et soutenir des familles d'enfants autistes.",
      recommendations: [
        'Commencez par la formation "Méthode TEACCH" (formation qualifiante)',
        'Explorez le catalogue de formations disponibles',
        "Rejoignez la communauté pour échanger avec d'autres bénévoles",
        'Complétez votre profil pour personnaliser votre expérience',
      ],
    };
  }
}
