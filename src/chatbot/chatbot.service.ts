import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Child, ChildDocument } from '../children/schemas/child.schema';
import {
  ReminderFrequency,
  ReminderType,
} from '../nutrition/schemas/task-reminder.schema';
import { CreateTaskReminderDto } from '../nutrition/dto/create-task-reminder.dto';
import { RemindersService } from '../nutrition/reminders.service';
import { ChildAccessService } from '../children/child-access.service';
import { getChatbotConfirmSecret } from '../common/config/runtime-security.util';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export type AssistantMode = 'message' | 'refresh';

export type AssistantRefreshReason = 'entry' | 'manual' | 'navigation';

export type AssistantLocale = 'fr' | 'en' | 'ar';

export interface AssistantContext {
  locale?: string;
  surface?: string;
  route?: string;
  uiContext?: Record<string, unknown>;
  forceRefresh?: boolean;
  mode?: AssistantMode;
  refreshReason?: AssistantRefreshReason;
}

export type AssistantRoutingStrategy =
  | 'default'
  | 'cached'
  | 'lite_model'
  | 'smart_model';

export interface AssistantResponseMeta {
  strategy: AssistantRoutingStrategy;
  complexity: 'simple' | 'complex';
  refreshed: boolean;
  cacheHit: boolean;
  generatedAt: string;
  reason: string;
}

export interface PendingAssistantAction {
  type: 'create_task_reminder';
  label: string;
  description: string;
  confirmToken: string;
  preview: {
    childId: string;
    childName: string;
    title: string;
    description?: string;
    time: string;
    frequency: ReminderFrequency.ONCE;
    reminderType: ReminderType.CUSTOM;
  };
}

export interface ChatbotChatResponse {
  reply: string;
  pendingAction?: PendingAssistantAction;
  meta: AssistantResponseMeta;
}

export interface ChatbotConfirmResponse {
  reply: string;
  execution?: {
    type: PendingAssistantAction['type'];
    status: 'confirmed';
    entityId?: string;
    summary: string;
  };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface AuthenticatedChatUser {
  id: string;
  role: string;
  organizationId?: string;
}

interface PendingActionTokenPayload {
  kind: 'chatbot-confirm';
  userId: string;
  role: string;
  locale?: AssistantLocale;
  action: {
    type: PendingAssistantAction['type'];
    childId: string;
    title: string;
    description?: string;
    time: string;
  };
}

type ProviderMode = 'simple' | 'complex';

interface CachedAssistantReply {
  reply: string;
  generatedAt: string;
  reason: string;
}

interface AssistantDecision {
  strategy: 'default' | 'lite_model' | 'smart_model';
  complexity: 'simple' | 'complex';
  reason: string;
  defaultReply?: string;
  cacheKey?: string;
  useTools: boolean;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly groqApiKey = process.env.GROQ_API_KEY;
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;
  private readonly chatbotConfirmSecret = getChatbotConfirmSecret(
    process.env.CHATBOT_CONFIRM_SECRET,
    process.env.JWT_SECRET,
  );
  private readonly simpleGroqModel =
    process.env.CHATBOT_SIMPLE_GROQ_MODEL || 'llama-3.1-8b-instant';
  private readonly complexGroqModel =
    process.env.CHATBOT_COMPLEX_GROQ_MODEL || 'llama-3.3-70b-versatile';
  private readonly simpleOpenAiModel =
    process.env.CHATBOT_SIMPLE_OPENAI_MODEL || 'gpt-4o-mini';
  private readonly complexOpenAiModel =
    process.env.CHATBOT_COMPLEX_OPENAI_MODEL || 'gpt-4o-mini';
  private readonly assistantCache = new Map<string, CachedAssistantReply>();
  private readonly assistantCacheTtlMs = 5 * 60 * 1000;
  private readonly assistantCacheMaxEntries = 200;
  private readonly routingCounters = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Child.name) private readonly childModel: Model<ChildDocument>,
    private readonly remindersService: RemindersService,
    private readonly childAccessService: ChildAccessService,
  ) {}

  private normalizeContext(
    context: AssistantContext,
    message: string | undefined,
  ): AssistantContext {
    const route =
      typeof context.route === 'string' && context.route.trim().length > 0
        ? context.route.trim()
        : undefined;
    const mode = this.resolveAssistantMode(context, message);
    return {
      locale: this.resolveAssistantLocale(context.locale, message),
      surface:
        typeof context.surface === 'string' && context.surface.trim().length > 0
          ? context.surface.trim()
          : 'unknown',
      route,
      uiContext: this.sanitizeUiContext(context.uiContext, route),
      forceRefresh: context.forceRefresh === true || mode === 'refresh',
      mode,
      refreshReason: this.resolveRefreshReason(context, message, mode),
    };
  }

  private resolveAssistantMode(
    context: AssistantContext,
    message: string | undefined,
  ): AssistantMode {
    if (context.mode === 'message' || context.mode === 'refresh') {
      return context.mode;
    }
    if (context.forceRefresh === true || this.isLegacyRefreshIntent(message)) {
      return 'refresh';
    }
    return 'message';
  }

  private resolveRefreshReason(
    context: AssistantContext,
    message: string | undefined,
    mode: AssistantMode,
  ): AssistantRefreshReason | undefined {
    if (mode !== 'refresh') {
      return undefined;
    }
    if (
      context.refreshReason === 'entry' ||
      context.refreshReason === 'manual' ||
      context.refreshReason === 'navigation'
    ) {
      return context.refreshReason;
    }
    if (this.isLegacyRefreshIntent(message) || !String(message ?? '').trim()) {
      return 'entry';
    }
    return context.forceRefresh === true ? 'manual' : 'entry';
  }

  private resolveAssistantLocale(
    locale: string | undefined,
    message: string | undefined,
  ): AssistantLocale {
    const normalized = String(locale ?? '')
      .trim()
      .toLowerCase();
    if (normalized.startsWith('ar')) return 'ar';
    if (normalized.startsWith('en')) return 'en';
    if (normalized.startsWith('fr')) return 'fr';

    const rawMessage = String(message ?? '');
    if (/[\u0600-\u06FF]/.test(rawMessage)) {
      return 'ar';
    }

    return 'fr';
  }

  async chat(
    actor: AuthenticatedChatUser,
    message: string | undefined,
    history: ChatMessage[],
    context: AssistantContext = {},
  ): Promise<ChatbotChatResponse> {
    const normalizedContext = this.normalizeContext(context, message);
    const trimmedMessage = String(message ?? '').trim();
    if (normalizedContext.mode !== 'refresh' && !trimmedMessage) {
      throw new BadRequestException('Message is required');
    }

    const user = await this.userModel
      .findById(actor.id)
      .select('fullName role organizationId')
      .lean()
      .exec();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const userName =
      String((user as { fullName?: string }).fullName ?? '').trim() ||
      'utilisateur';
    const role =
      String((user as { role?: string }).role ?? actor.role ?? '').trim() ||
      actor.role;

    if (role !== 'family') {
      return this.generateReadOnlyReply(
        userName,
        role,
        trimmedMessage,
        history,
        normalizedContext,
      );
    }

    return this.generateFamilyReply(
      actor.id,
      userName,
      trimmedMessage,
      history,
      normalizedContext,
    );
  }

  async confirm(
    actor: AuthenticatedChatUser,
    confirmToken: string,
  ): Promise<ChatbotConfirmResponse> {
    let payload: PendingActionTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<PendingActionTokenPayload>(
        confirmToken,
        { secret: this.chatbotConfirmSecret },
      );
    } catch (error) {
      this.logger.warn(
        `Invalid chatbot confirmation token for user ${actor.id}: ${(error as Error).message}`,
      );
      throw new BadRequestException('Confirmation token is invalid or expired');
    }

    if (
      payload.kind !== 'chatbot-confirm' ||
      payload.userId !== actor.id ||
      payload.role !== actor.role
    ) {
      throw new UnauthorizedException(
        'This confirmation token is not valid for the current session',
      );
    }

    switch (payload.action.type) {
      case 'create_task_reminder':
        return this.confirmCreateTaskReminder(
          actor.id,
          payload.action,
          payload.locale,
        );
      default:
        throw new BadRequestException('Unsupported assistant action');
    }
  }

  private async tryProviders(
    messages: OpenAIMessage[],
    tools: any[],
    userName: string,
    mode: ProviderMode,
  ): Promise<any> {
    if (this.groqApiKey) {
      try {
        return await this.callOpenAICompatible(
          'https://api.groq.com/openai/v1/chat/completions',
          this.groqApiKey,
          this.resolveModelName('groq', mode),
          messages,
          tools,
          mode,
        );
      } catch (error) {
        this.logger.warn(
          `Groq ${mode} route failed: ${(error as Error).message}. Trying OpenAI...`,
        );
      }
    }

    if (this.openaiApiKey) {
      try {
        return await this.callOpenAICompatible(
          'https://api.openai.com/v1/chat/completions',
          this.openaiApiKey,
          this.resolveModelName('openai', mode),
          messages,
          tools,
          mode,
        );
      } catch (error) {
        this.logger.error(
          `OpenAI ${mode} route failed: ${(error as Error).message}`,
        );
        throw new Error(
          `Désolé ${userName}, tous les services AI sont temporairement indisponibles.`,
        );
      }
    }

    throw new Error(`${userName}, aucune clé API n'est configurée.`);
  }

  private resolveModelName(
    provider: 'groq' | 'openai',
    mode: ProviderMode,
  ): string {
    if (provider === 'groq') {
      return mode === 'simple' ? this.simpleGroqModel : this.complexGroqModel;
    }
    return mode === 'simple' ? this.simpleOpenAiModel : this.complexOpenAiModel;
  }

  private async callOpenAICompatible(
    url: string,
    apiKey: string,
    model: string,
    messages: OpenAIMessage[],
    tools: any[],
    mode: ProviderMode,
  ): Promise<any> {
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: mode === 'simple' ? 220 : 512,
      temperature: mode === 'simple' ? 0.2 : 0.7,
    };
    if (tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    const response = await axios.post(url, requestBody, {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const messageData = (
      response.data as { choices?: Array<{ message?: unknown }> }
    )?.choices?.[0]?.message;
    if (!messageData) {
      throw new Error('Empty response from API');
    }
    return messageData;
  }

  private async generateReadOnlyReply(
    userName: string,
    role: string,
    message: string,
    history: ChatMessage[],
    context: AssistantContext,
  ): Promise<ChatbotChatResponse> {
    const locale = this.getLocale(context);
    const refreshed = this.isRefreshRequest(context);
    const decision = this.resolveReadOnlyDecision(
      userName,
      role,
      message,
      history,
      context,
      locale,
    );
    const cached = this.readCachedReply(decision.cacheKey, refreshed);
    if (cached) {
      return this.buildChatResponse(cached.reply, {
        strategy: 'cached',
        complexity: 'simple',
        refreshed: false,
        cacheHit: true,
        generatedAt: cached.generatedAt,
        reason: cached.reason,
      });
    }

    if (decision.defaultReply) {
      return this.buildChatResponse(
        decision.defaultReply,
        this.buildMeta(
          decision.strategy,
          decision.complexity,
          decision.reason,
          {
            refreshed,
          },
        ),
      );
    }

    const messages = this.buildMessages(
      this.buildReadOnlySystemPrompt(userName, role, context, locale),
      this.resolveReadOnlyUserPrompt(role, message, context, locale),
      history,
      decision.complexity,
      context.mode ?? 'message',
    );

    try {
      const responseMessage = await this.tryProviders(
        messages,
        [],
        userName,
        decision.strategy === 'lite_model' ? 'simple' : 'complex',
      );
      const reply = this.enforceReplyLocale(
        this.extractReplyContent(responseMessage),
        locale,
      );
      const meta = this.buildMeta(
        decision.strategy,
        decision.complexity,
        decision.reason,
        {
          refreshed,
        },
      );
      this.writeCachedReply(decision.cacheKey, reply, meta);
      return this.buildChatResponse(reply, meta);
    } catch (error) {
      this.logger.warn(
        `Read-only assistant fallback for role=${role}: ${(error as Error).message}`,
      );
      return this.buildChatResponse(
        this.buildReadOnlyFallbackReply(userName, role, context, locale),
        this.buildMeta(
          decision.strategy,
          decision.complexity,
          'dashboard_provider_fallback',
          {
            refreshed,
          },
        ),
      );
    }
  }

  private async generateFamilyReply(
    userId: string,
    userName: string,
    message: string,
    history: ChatMessage[],
    context: AssistantContext,
  ): Promise<ChatbotChatResponse> {
    const locale = this.getLocale(context);
    const refreshed = this.isRefreshRequest(context);
    const children = await this.childModel
      .find({ parentId: new Types.ObjectId(userId) })
      .select('fullName dateOfBirth diagnosis')
      .lean()
      .exec();

    const decision = this.resolveFamilyDecision(
      userName,
      message,
      history,
      context,
      children,
      locale,
    );
    const cached = this.readCachedReply(decision.cacheKey, refreshed);
    if (cached) {
      return this.buildChatResponse(cached.reply, {
        strategy: 'cached',
        complexity: 'simple',
        refreshed: false,
        cacheHit: true,
        generatedAt: cached.generatedAt,
        reason: cached.reason,
      });
    }

    if (decision.defaultReply) {
      return this.buildChatResponse(
        decision.defaultReply,
        this.buildMeta(
          decision.strategy,
          decision.complexity,
          decision.reason,
          {
            refreshed,
          },
        ),
      );
    }

    const messages = this.buildMessages(
      this.buildFamilySystemPrompt(userName, children, context, locale),
      this.resolveFamilyUserPrompt(message, context, locale),
      history,
      decision.complexity,
      context.mode ?? 'message',
    );
    const tools = decision.useTools ? [this.buildPrepareRoutineTaskTool()] : [];

    try {
      const responseMessage = await this.tryProviders(
        messages,
        tools,
        userName,
        decision.strategy === 'lite_model' ? 'simple' : 'complex',
      );
      const toolCalls = Array.isArray(responseMessage.tool_calls)
        ? responseMessage.tool_calls
        : [];

      if (toolCalls.length > 0) {
        const toolCall = toolCalls[0] as {
          function?: { name?: string; arguments?: string };
        };
        const pendingAction = await this.preparePendingAction(
          userId,
          'family',
          toolCall,
          children,
          locale,
        );
        if (pendingAction) {
          return this.buildChatResponse(
            this.buildPendingReminderReply(pendingAction, locale),
            this.buildMeta('smart_model', 'complex', 'family_action_prepared', {
              refreshed,
            }),
            pendingAction,
          );
        }
      }

      const reply = this.enforceReplyLocale(
        this.extractReplyContent(responseMessage),
        locale,
      );
      const meta = this.buildMeta(
        decision.strategy,
        decision.complexity,
        decision.reason,
        {
          refreshed,
        },
      );
      this.writeCachedReply(decision.cacheKey, reply, meta);
      return this.buildChatResponse(reply, meta);
    } catch (error) {
      this.logger.warn(
        `Family assistant fallback for user ${userId}: ${(error as Error).message}`,
      );
      return this.buildChatResponse(
        this.translateLiteral(
          locale,
          "Je suis temporairement indisponible pour préparer une action. Vous pouvez toujours créer le rappel manuellement depuis l'écran routine de votre enfant.",
          'I am temporarily unavailable to prepare this action. You can still create the reminder manually from your child routine screen.',
          'أنا غير متاح مؤقتًا لتحضير هذا الإجراء. يمكنك دائمًا إنشاء التذكير يدويًا من شاشة روتين طفلك.',
        ),
        this.buildMeta(
          decision.strategy,
          decision.complexity,
          'family_provider_fallback',
          {
            refreshed,
          },
        ),
      );
    }
  }

  private resolveReadOnlyDecision(
    userName: string,
    role: string,
    message: string,
    history: ChatMessage[],
    context: AssistantContext,
    locale: AssistantLocale,
  ): AssistantDecision {
    if (this.isRefreshRequest(context)) {
      const refreshReply = this.buildReadOnlyRefreshReply(
        userName,
        role,
        context,
        locale,
      );
      if (refreshReply) {
        return {
          strategy: 'default',
          complexity: 'simple',
          reason: `dashboard_refresh_${context.refreshReason ?? 'manual'}`,
          defaultReply: refreshReply,
          useTools: false,
        };
      }
    }

    const defaultReply = this.buildReadOnlyDefaultReply(
      userName,
      role,
      message,
      locale,
    );
    if (defaultReply) {
      return {
        strategy: 'default',
        complexity: 'simple',
        reason: 'dashboard_common_prompt',
        defaultReply,
        useTools: false,
      };
    }

    const complexity = this.shouldUseSmartModel(message, history, context)
      ? 'complex'
      : 'simple';
    return {
      strategy: complexity === 'simple' ? 'lite_model' : 'smart_model',
      complexity,
      reason:
        complexity === 'simple'
          ? 'dashboard_simple_prompt'
          : 'dashboard_complex_prompt',
      cacheKey:
        complexity === 'simple' && this.isCacheEligible(role, message, context)
          ? this.buildCacheKey(role, message, context)
          : undefined,
      useTools: false,
    };
  }

  private resolveFamilyDecision(
    userName: string,
    message: string,
    history: ChatMessage[],
    context: AssistantContext,
    children: unknown[],
    locale: AssistantLocale,
  ): AssistantDecision {
    if (this.isRefreshRequest(context)) {
      const refreshReply = this.buildFamilyRefreshReply(
        userName,
        context,
        children,
        locale,
      );
      if (refreshReply) {
        return {
          strategy: 'default',
          complexity: 'simple',
          reason: `family_refresh_${context.refreshReason ?? 'manual'}`,
          defaultReply: refreshReply,
          useTools: false,
        };
      }
    }

    const defaultReply = this.buildFamilyDefaultReply(
      userName,
      message,
      children,
      locale,
    );
    if (defaultReply) {
      return {
        strategy: 'default',
        complexity: 'simple',
        reason: 'family_common_prompt',
        defaultReply,
        useTools: false,
      };
    }

    if (this.isTaskCreationIntent(message)) {
      return {
        strategy: 'smart_model',
        complexity: 'complex',
        reason: 'family_action_request',
        useTools: true,
      };
    }

    const complexity = this.shouldUseSmartModel(message, history, context)
      ? 'complex'
      : 'simple';
    return {
      strategy: complexity === 'simple' ? 'lite_model' : 'smart_model',
      complexity,
      reason:
        complexity === 'simple'
          ? 'family_simple_prompt'
          : 'family_complex_prompt',
      cacheKey:
        complexity === 'simple' &&
        this.isCacheEligible('family', message, context)
          ? this.buildCacheKey('family', message, context)
          : undefined,
      useTools: false,
    };
  }

  private buildMessages(
    systemPrompt: string,
    message: string,
    history: ChatMessage[],
    complexity: 'simple' | 'complex',
    mode: AssistantMode,
  ): OpenAIMessage[] {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
    ];
    const compactHistory =
      mode === 'refresh'
        ? []
        : this.compactHistory(history, complexity === 'simple' ? 3 : 5);

    for (const item of compactHistory) {
      messages.push({
        role: item.role === 'model' ? 'assistant' : 'user',
        content: item.content,
      });
    }

    messages.push({ role: 'user', content: message });
    return messages;
  }

  private buildFamilySystemPrompt(
    userName: string,
    children: unknown[],
    context: AssistantContext,
    locale: AssistantLocale,
  ): string {
    const childrenInfo =
      children.length > 0
        ? children
            .map((entry: unknown) => {
              const child = entry as {
                _id?: { toString(): string };
                id?: { toString(): string };
                fullName?: string;
                dateOfBirth?: string;
                diagnosis?: string;
              };
              const childId =
                child._id?.toString() || child.id?.toString() || '';
              const age = child.dateOfBirth
                ? Math.floor(
                    (Date.now() - new Date(child.dateOfBirth).getTime()) /
                      (1000 * 60 * 60 * 24 * 365),
                  )
                : null;
              return `- ID: ${childId}, Nom: ${child.fullName}${age ? ` (${age} ans)` : ''}${child.diagnosis ? `, suivi par ${child.diagnosis}` : ''}`;
            })
            .join('\n')
        : 'Aucun enfant enregistré.';

    return `Tu es Cogni, l'assistant IA de CogniCare pour les familles.
Tu aides ${userName}.
Contexte d'interface compact:
${this.describeAssistantContext(context, locale)}

Enfants suivis:
${childrenInfo}

Tu peux répondre aux questions sur les routines, les rappels, les progrès, les suggestions thérapeutiques générales (PECS, TEACCH, activités sensorielles) et la planification quotidienne.
Si l'utilisateur demande clairement d'ajouter une tâche ou un rappel, prépare l'action avec l'outil "prepare_routine_task". N'exécute jamais l'action directement.
Si l'utilisateur a un seul enfant, utilise automatiquement son ID. S'il y en a plusieurs et que l'enfant n'est pas clair, demande d'abord le prénom.
Ne demande jamais l'ID directement à l'utilisateur.
Sois chaleureux, concis (2 à 4 phrases sauf si demandé), bienveillant, et ne donne jamais de diagnostic médical.
${this.outputLanguageRule(locale)}`;
  }

  private buildReadOnlySystemPrompt(
    userName: string,
    role: string,
    context: AssistantContext,
    locale: AssistantLocale,
  ): string {
    return `Tu es Cogni, l'assistant de tableau de bord de CogniCare.
Tu aides ${userName}, connecté avec le rôle "${role}".
Contexte d'interface compact:
${this.describeAssistantContext(context, locale)}

Tu es en mode lecture seule. Tu n'exécutes aucune action, tu ne promets aucune mutation, tu ne dis jamais qu'une donnée a été modifiée.
Ta mission: expliquer les métriques visibles, résumer l'état du tableau de bord courant, suggérer le prochain écran pertinent, et répondre à partir du contexte fourni sans inventer d'informations.
Sois concis, clair, opérationnel, et évite toute donnée sensible non fournie.
${this.outputLanguageRule(locale)}`;
  }

  private resolveFamilyUserPrompt(
    message: string,
    context: AssistantContext,
    locale: AssistantLocale,
  ): string {
    if (!this.isRefreshRequest(context)) {
      return message;
    }

    if (locale === 'ar') {
      return `قدّم ملخصًا سريعًا ومحدّثًا عن ${this.describeFamilyRoute(
        context.route,
        locale,
      )}. استخدم المعلومات المتاحة فقط، واذكر نقطتين أو ثلاث نقاط كحد أقصى، ثم اقترح الخطوة التالية المفيدة للأسرة.`;
    }
    if (locale === 'en') {
      return `Give a quick updated snapshot of ${this.describeFamilyRoute(
        context.route,
        locale,
      )}. Use only provided context, mention 2-3 concrete points max, then suggest the next useful step for the family.`;
    }
    return `Donne un point rapide et actualisé sur ${this.describeFamilyRoute(
      context.route,
      locale,
    )}. Utilise uniquement le contexte fourni, cite 2 ou 3 éléments concrets maximum et rappelle la prochaine chose utile que la famille peut me demander.`;
  }

  private resolveReadOnlyUserPrompt(
    role: string,
    message: string,
    context: AssistantContext,
    locale: AssistantLocale,
  ): string {
    if (!this.isRefreshRequest(context)) {
      return message;
    }

    if (locale === 'ar') {
      return `لخّص بشكل محدّث ${this.describeDashboardRoute(
        context.route,
        role,
        locale,
      )}. استخدم المعلومات المتاحة فقط، واذكر نقطتين أو ثلاث نقاط كحد أقصى، ثم اقترح الشاشة التالية الأكثر فائدة.`;
    }
    if (locale === 'en') {
      return `Provide an updated summary for ${this.describeDashboardRoute(
        context.route,
        role,
        locale,
      )}. Use only provided context, mention 2-3 concrete points max, then suggest the most useful next screen.`;
    }
    return `Résume de façon actualisée ${this.describeDashboardRoute(
      context.route,
      role,
      locale,
    )}. Utilise uniquement le contexte fourni, cite 2 ou 3 points concrets maximum puis suggère l'écran suivant le plus utile.`;
  }

  private describeAssistantContext(
    context: AssistantContext,
    locale: AssistantLocale,
  ): string {
    const summary = this.summarizeUiContext(context.uiContext);
    const contextLabel =
      locale === 'ar' ? 'السياق' : locale === 'en' ? 'context' : 'contexte';
    const lines = [
      `- surface: ${context.surface ?? 'unknown'}`,
      `- route: ${context.route ?? 'unknown'}`,
      `- mode: ${context.mode ?? 'message'}${
        context.refreshReason ? ` (${context.refreshReason})` : ''
      }`,
      `- ${contextLabel}: ${summary}`,
    ];
    return lines.join('\n');
  }

  private isRefreshRequest(context: AssistantContext): boolean {
    return context.mode === 'refresh' || context.forceRefresh === true;
  }

  private sanitizeUiContext(
    uiContext: Record<string, unknown> | undefined,
    route: string | undefined,
  ): Record<string, unknown> {
    if (!uiContext || typeof uiContext !== 'object') {
      return {};
    }

    const normalizedRoute = String(route ?? '').toLowerCase();
    if (normalizedRoute.includes('/admin')) {
      return this.pickUiContext(uiContext, {
        scalarKeys: [
          'page',
          'totalUsers',
          'totalOrganizations',
          'pendingReviews',
          'totalFamilies',
          'aiConfigured',
        ],
      });
    }

    if (normalizedRoute.includes('/org')) {
      return this.pickUiContext(uiContext, {
        scalarKeys: [
          'page',
          'totalStaff',
          'totalFamilies',
          'totalChildren',
          'invitations',
        ],
        objectKeys: {
          selectedSpecialist: ['name', 'role'],
          specialistSummary: [
            'totalPlans',
            'childrenCount',
            'approvalRatePercent',
            'resultsImprovedRatePercent',
          ],
        },
      });
    }

    if (normalizedRoute.includes('/specialist')) {
      return this.pickUiContext(uiContext, {
        scalarKeys: [
          'page',
          'totalChildren',
          'organizationChildren',
          'privateChildren',
          'totalPlans',
          'pecsBoards',
          'teacchTrackers',
          'suggestionCount',
        ],
        arrayKeys: {
          topSuggestions: 2,
        },
      });
    }

    return this.pickUiContext(uiContext, {
      scalarKeys: [
        'screen',
        'messageCount',
        'hasPendingAction',
        'quickActionsVisible',
      ],
    });
  }

  private pickUiContext(
    source: Record<string, unknown>,
    config: {
      scalarKeys: string[];
      objectKeys?: Record<string, string[]>;
      arrayKeys?: Record<string, number>;
    },
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const key of config.scalarKeys) {
      const value = source[key];
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        sanitized[key] = value;
      }
    }

    for (const [key, nestedKeys] of Object.entries(config.objectKeys ?? {})) {
      const value = source[key];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const nested: Record<string, unknown> = {};
      for (const nestedKey of nestedKeys) {
        const nestedValue = (value as Record<string, unknown>)[nestedKey];
        if (
          typeof nestedValue === 'string' ||
          typeof nestedValue === 'number' ||
          typeof nestedValue === 'boolean'
        ) {
          nested[nestedKey] = nestedValue;
        }
      }

      if (Object.keys(nested).length > 0) {
        sanitized[key] = nested;
      }
    }

    for (const [key, limit] of Object.entries(config.arrayKeys ?? {})) {
      const value = source[key];
      if (!Array.isArray(value)) {
        continue;
      }

      const items = value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .slice(0, limit);

      if (items.length > 0) {
        sanitized[key] = items;
      }
    }

    return sanitized;
  }

  private buildReadOnlyContextSummary(
    role: string,
    route: string | undefined,
    uiContext: Record<string, unknown> | undefined,
  ): string | null {
    const page = this.readString(uiContext, 'page');

    if (role === 'admin' || page === 'admin-overview') {
      const totalUsers = this.readNumber(uiContext, 'totalUsers');
      const totalOrganizations = this.readNumber(
        uiContext,
        'totalOrganizations',
      );
      const pendingReviews = this.readNumber(uiContext, 'pendingReviews');
      const totalFamilies = this.readNumber(uiContext, 'totalFamilies');
      const aiConfigured = this.readBoolean(uiContext, 'aiConfigured');
      if (
        totalUsers == null &&
        totalOrganizations == null &&
        pendingReviews == null &&
        totalFamilies == null
      ) {
        return null;
      }

      const parts = [
        totalUsers != null ? `${totalUsers} utilisateurs au total.` : null,
        totalOrganizations != null
          ? `${totalOrganizations} organisations suivies.`
          : null,
        pendingReviews != null ? `${pendingReviews} revues en attente.` : null,
        totalFamilies != null
          ? `${totalFamilies} familles enregistrées.`
          : null,
        aiConfigured != null
          ? aiConfigured
            ? "L'analyse IA d'organisation est disponible."
            : "La configuration IA d'organisation reste incomplète."
          : null,
      ].filter(Boolean);

      return parts.join(' ');
    }

    if (role === 'organization_leader' || page === 'org-overview') {
      const totalStaff = this.readNumber(uiContext, 'totalStaff');
      const totalFamilies = this.readNumber(uiContext, 'totalFamilies');
      const totalChildren = this.readNumber(uiContext, 'totalChildren');
      const invitations = this.readNumber(uiContext, 'invitations');
      const selectedSpecialist = this.readObject(
        uiContext,
        'selectedSpecialist',
      );
      const specialistSummary = this.readObject(uiContext, 'specialistSummary');

      if (
        totalStaff == null &&
        totalFamilies == null &&
        totalChildren == null &&
        invitations == null &&
        !selectedSpecialist &&
        !specialistSummary
      ) {
        return null;
      }

      const parts = [
        totalStaff != null ? `${totalStaff} membres du staff.` : null,
        totalFamilies != null ? `${totalFamilies} familles suivies.` : null,
        totalChildren != null ? `${totalChildren} enfants rattachés.` : null,
        invitations != null ? `${invitations} invitations ouvertes.` : null,
      ].filter(Boolean);

      const specialistName = this.readString(selectedSpecialist, 'name');
      if (specialistName) {
        const planCount = this.readNumber(specialistSummary, 'totalPlans');
        const childrenCount = this.readNumber(
          specialistSummary,
          'childrenCount',
        );
        parts.push(
          `${specialistName} est actuellement sélectionné(e)${
            planCount != null || childrenCount != null
              ? ` avec ${planCount ?? 0} plans et ${childrenCount ?? 0} enfants analysés`
              : ''
          }.`,
        );
      }

      return parts.join(' ');
    }

    if (role === 'careProvider' || route?.includes('/specialist')) {
      const totalChildren = this.readNumber(uiContext, 'totalChildren');
      const organizationChildren = this.readNumber(
        uiContext,
        'organizationChildren',
      );
      const privateChildren = this.readNumber(uiContext, 'privateChildren');
      const totalPlans = this.readNumber(uiContext, 'totalPlans');
      const pecsBoards = this.readNumber(uiContext, 'pecsBoards');
      const teacchTrackers = this.readNumber(uiContext, 'teacchTrackers');
      const suggestionCount = this.readNumber(uiContext, 'suggestionCount');
      const topSuggestions = this.readStringArray(uiContext, 'topSuggestions');

      if (
        totalChildren == null &&
        organizationChildren == null &&
        privateChildren == null &&
        totalPlans == null &&
        pecsBoards == null &&
        teacchTrackers == null &&
        suggestionCount == null
      ) {
        return null;
      }

      const parts = [
        totalChildren != null
          ? `${totalChildren} enfants uniques suivis au total.`
          : null,
        organizationChildren != null
          ? `${organizationChildren} enfants d'organisation visibles.`
          : null,
        privateChildren != null
          ? `${privateChildren} patients privés visibles.`
          : null,
        totalPlans != null ? `${totalPlans} plans disponibles.` : null,
        pecsBoards != null ? `${pecsBoards} supports PECS.` : null,
        teacchTrackers != null ? `${teacchTrackers} suivis TEACCH.` : null,
        suggestionCount != null
          ? `${suggestionCount} suggestions IA prêtes.`
          : null,
        topSuggestions.length > 0
          ? `Suggestion phare: ${topSuggestions[0]}.`
          : null,
      ].filter(Boolean);

      return parts.join(' ');
    }

    return null;
  }

  private buildReadOnlyNextStep(
    role: string,
    route: string | undefined,
    uiContext: Record<string, unknown> | undefined,
  ): string | null {
    const page = this.readString(uiContext, 'page');

    if (role === 'admin' || page === 'admin-overview') {
      const pendingReviews = this.readNumber(uiContext, 'pendingReviews') ?? 0;
      if (pendingReviews > 0) {
        return 'Prochaine page utile: ouvrez Reviews pour traiter les validations en attente.';
      }
      return 'Prochaine page utile: ouvrez Users ou Organizations pour approfondir un segment précis.';
    }

    if (role === 'organization_leader' || page === 'org-overview') {
      const invitations = this.readNumber(uiContext, 'invitations') ?? 0;
      if (invitations > 0) {
        return 'Prochaine page utile: ouvrez Invitations pour suivre les accès en attente.';
      }
      if (this.readObject(uiContext, 'selectedSpecialist')) {
        return 'Prochaine page utile: consultez la fiche du spécialiste sélectionné pour détailler ses résultats.';
      }
      return 'Prochaine page utile: ouvrez Staff ou Families selon le groupe à vérifier.';
    }

    if (role === 'careProvider' || route?.includes('/specialist')) {
      const suggestionCount =
        this.readNumber(uiContext, 'suggestionCount') ?? 0;
      if (suggestionCount > 0) {
        return 'Prochaine page utile: ouvrez Children ou Plans pour transformer ces suggestions en suivi concret.';
      }
      return 'Prochaine page utile: ouvrez Plans pour revoir les supports actifs ou Children pour un patient précis.';
    }

    return null;
  }

  private describeFamilyRouteHint(
    route: string | undefined,
    locale: AssistantLocale,
  ): string {
    const value = String(route ?? '').toLowerCase();
    if (value.includes('routine') || value.includes('schedule')) {
      return this.translateLiteral(
        locale,
        'Je peux préparer un rappel si vous me donnez la tâche et l’heure.',
        'I can prepare a reminder if you provide the task and time.',
        'يمكنني تحضير تذكير إذا زودتني بالمهمة والوقت.',
      );
    }
    if (value.includes('progress')) {
      return this.translateLiteral(
        locale,
        'Je peux expliquer une tendance visible ou proposer la prochaine vérification utile.',
        'I can explain a visible trend or suggest the next useful check.',
        'يمكنني شرح اتجاه ظاهر أو اقتراح التحقق التالي المفيد.',
      );
    }
    return this.translateLiteral(
      locale,
      'Je peux vous aider sur les routines, les rappels et les progrès visibles.',
      'I can help with routines, reminders, and visible progress.',
      'يمكنني مساعدتك في الروتين والتذكيرات والتقدم الظاهر.',
    );
  }

  private readNumber(
    source: Record<string, unknown> | undefined | null,
    key: string,
  ): number | null {
    const value = source?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private readString(
    source: Record<string, unknown> | undefined | null,
    key: string,
  ): string | null {
    const value = source?.[key];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private readBoolean(
    source: Record<string, unknown> | undefined | null,
    key: string,
  ): boolean | null {
    const value = source?.[key];
    return typeof value === 'boolean' ? value : null;
  }

  private readObject(
    source: Record<string, unknown> | undefined | null,
    key: string,
  ): Record<string, unknown> | null {
    const value = source?.[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readStringArray(
    source: Record<string, unknown> | undefined | null,
    key: string,
  ): string[] {
    const value = source?.[key];
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }

  private buildFamilyDefaultReply(
    userName: string,
    message: string,
    children: unknown[],
    locale: AssistantLocale,
  ): string | null {
    if (this.isHelpIntent(message)) {
      const childSummary =
        children.length === 0
          ? this.translateLiteral(
              locale,
              "Je n'ai pas encore d'enfant chargé dans cette session.",
              "I don't have any child loaded in this session yet.",
              'لا يوجد طفل محمّل في هذه الجلسة حتى الآن.',
            )
          : children.length === 1
            ? this.translateLiteral(
                locale,
                `Je suis prêt à aider pour ${this.extractChildName(children[0])}.`,
                `I am ready to help for ${this.extractChildName(children[0])}.`,
                `أنا جاهز للمساعدة من أجل ${this.extractChildName(children[0])}.`,
              )
            : this.translateLiteral(
                locale,
                `Je suis prêt à aider pour ${children.length} enfants suivis dans votre compte.`,
                `I am ready to help for ${children.length} children linked to your account.`,
                `أنا جاهز للمساعدة لعدد ${children.length} من الأطفال المرتبطين بحسابك.`,
              );
      return this.translateLiteral(
        locale,
        `${userName}, je peux répondre vite sur les routines, les rappels, les progrès et les suggestions générales. ${childSummary} Si vous voulez créer un rappel, dites-moi simplement l'enfant, la tâche et l'heure.`,
        `${userName}, I can quickly help with routines, reminders, progress, and general suggestions. ${childSummary} If you want to create a reminder, just tell me the child, task title, and time.`,
        `${userName}، يمكنني مساعدتك بسرعة في الروتين والتذكيرات والتقدم والاقتراحات العامة. ${childSummary} إذا أردت إنشاء تذكير، فقط أخبرني باسم الطفل وعنوان المهمة والوقت.`,
      );
    }

    if (this.isTaskPlanningHint(message)) {
      return this.translateLiteral(
        locale,
        "Pour préparer un rappel sans coût AI inutile, donnez-moi directement l'enfant concerné, le titre de la tâche et l'heure souhaitée au format HH:mm.",
        'To prepare a reminder without unnecessary AI cost, give me the child, task title, and desired time in HH:mm format.',
        'لتحضير تذكير بدون كلفة ذكاء اصطناعي غير ضرورية، أعطني مباشرة الطفل المعني وعنوان المهمة والوقت بصيغة HH:mm.',
      );
    }

    return null;
  }

  private buildReadOnlyDefaultReply(
    userName: string,
    role: string,
    message: string,
    locale: AssistantLocale,
  ): string | null {
    if (this.isHelpIntent(message)) {
      return this.translateLiteral(
        locale,
        `${userName}, je peux expliquer rapidement les métriques visibles, résumer l'écran courant et vous orienter vers la bonne page ${role === 'admin' ? 'admin' : 'de travail'}. Utilisez le bouton d’actualisation pour recalculer le contexte courant.`,
        `${userName}, I can quickly explain visible metrics, summarize the current screen, and guide you to the right ${role === 'admin' ? 'admin' : 'working'} page. Use refresh to recompute current context.`,
        `${userName}، يمكنني شرح المؤشرات الظاهرة بسرعة، وتلخيص الشاشة الحالية، وتوجيهك إلى الصفحة المناسبة ${role === 'admin' ? 'للإدارة' : 'للعمل'}. استخدم التحديث لإعادة حساب السياق الحالي.`,
      );
    }

    return null;
  }

  private buildFamilyRefreshReply(
    userName: string,
    context: AssistantContext,
    children: unknown[],
    locale: AssistantLocale,
  ): string | null {
    const routeLabel = this.describeFamilyRoute(context.route, locale);
    const childSummary =
      children.length === 0
        ? this.translateLiteral(
            locale,
            'Aucun enfant n’est associé à ce compte pour le moment.',
            'No child is linked to this account at the moment.',
            'لا يوجد طفل مرتبط بهذا الحساب في الوقت الحالي.',
          )
        : children.length === 1
          ? this.translateLiteral(
              locale,
              `${this.extractChildName(children[0])} est prêt(e) pour un suivi rapide.`,
              `${this.extractChildName(children[0])} is ready for a quick follow-up.`,
              `${this.extractChildName(children[0])} جاهز لمتابعة سريعة.`,
            )
          : this.translateLiteral(
              locale,
              `${children.length} enfants sont disponibles dans cette session.`,
              `${children.length} children are available in this session.`,
              `يوجد ${children.length} أطفال متاحون في هذه الجلسة.`,
            );
    const hasPendingAction = this.readBoolean(
      context.uiContext,
      'hasPendingAction',
    );
    const routeHint = this.describeFamilyRouteHint(context.route, locale);
    const pendingActionHint = hasPendingAction
      ? this.translateLiteral(
          locale,
          'Une action attend déjà votre confirmation.',
          'An action is already waiting for your confirmation.',
          'يوجد إجراء بانتظار تأكيدك.',
        )
      : '';

    return this.translateLiteral(
      locale,
      `${userName}, aperçu actualisé pour ${routeLabel}. ${childSummary} ${routeHint}${pendingActionHint ? ` ${pendingActionHint}` : ''}`.trim(),
      `${userName}, updated snapshot for ${routeLabel}. ${childSummary} ${routeHint}${pendingActionHint ? ` ${pendingActionHint}` : ''}`.trim(),
      `${userName}، هذه نظرة محدثة لـ ${routeLabel}. ${childSummary} ${routeHint}${pendingActionHint ? ` ${pendingActionHint}` : ''}`.trim(),
    );
  }

  private buildReadOnlyRefreshReply(
    userName: string,
    role: string,
    context: AssistantContext,
    locale: AssistantLocale,
  ): string | null {
    const routeLabel = this.describeDashboardRoute(context.route, role, locale);
    const contextBits = this.buildReadOnlyContextSummary(
      role,
      context.route,
      context.uiContext,
    );
    if (!contextBits) {
      return null;
    }

    const nextStep = this.buildReadOnlyNextStep(
      role,
      context.route,
      context.uiContext,
    );
    return this.translateLiteral(
      locale,
      `${userName}, aperçu actualisé pour ${routeLabel}. ${contextBits}${nextStep ? ` ${nextStep}` : ''}`.trim(),
      `${userName}, updated snapshot for ${routeLabel}. ${contextBits}${nextStep ? ` ${nextStep}` : ''}`.trim(),
      `${userName}، هذه نظرة محدثة لـ ${routeLabel}. ${contextBits}${nextStep ? ` ${nextStep}` : ''}`.trim(),
    );
  }

  private isHelpIntent(message: string): boolean {
    const normalized = this.normalizeQuestion(message);
    return (
      /^(bonjour|salut|hello|hi|help|aide|hey|مرحبا|سلام|مساعدة)$/.test(
        normalized,
      ) ||
      /^(que peux tu faire|what can you do|comment peux tu m aider|how can you help|ماذا يمكنك|كيف تساعدني)$/.test(
        normalized,
      )
    );
  }

  private isLegacyRefreshIntent(message: string | undefined): boolean {
    const normalized = this.normalizeQuestion(String(message ?? ''));
    return (
      normalized === 'assistant_refresh' ||
      /^(screen summary|dashboard summary|resume cet ecran|resume ce tableau|summari[sz]e this (screen|dashboard))$/.test(
        normalized,
      )
    );
  }

  private isTaskPlanningHint(message: string): boolean {
    const normalized = this.normalizeQuestion(message);
    return /^(planifier une tache|planifier un rappel|how do i create a reminder|comment creer un rappel|كيف انشئ تذكير|كيف اضيف تذكير)$/.test(
      normalized,
    );
  }

  private isTaskCreationIntent(message: string): boolean {
    const normalized = this.normalizeQuestion(message);
    return /(ajoute|cree|cree moi|create|add|planifie|schedule|remind|rappel|task|اضف|انشئ|ذكرني|تذكير|مهمة)/.test(
      normalized,
    );
  }

  private shouldUseSmartModel(
    message: string,
    history: ChatMessage[],
    context: AssistantContext,
  ): boolean {
    const normalized = this.normalizeQuestion(message);
    const tokenCount = normalized.split(' ').filter(Boolean).length;
    if (this.isRefreshRequest(context)) {
      return false;
    }
    if (history.length >= 8) {
      return true;
    }
    if (tokenCount > 20) {
      return true;
    }
    return this.isContextSensitiveQuestion(normalized);
  }

  private isContextSensitiveQuestion(normalized: string): boolean {
    return /(pourquoi|comment|analyse|analy[sz]e|compare|trend|tendance|personnalis|detail|insight|reason|next step|prochaine etape|child|enfant|routine|rappel|reminder|progress|progres|plan|لماذا|كيف|تحليل|قارن|اتجاه|طفل|روتين|تذكير|تقدم|خطة)/.test(
      normalized,
    );
  }

  private isCacheEligible(
    role: string,
    message: string,
    context: AssistantContext,
  ): boolean {
    if (this.isRefreshRequest(context)) {
      return false;
    }

    const normalized = this.normalizeQuestion(message);
    if (!normalized || normalized.split(' ').filter(Boolean).length > 10) {
      return false;
    }

    if (
      this.isTaskCreationIntent(message) ||
      this.isContextSensitiveQuestion(normalized)
    ) {
      return false;
    }

    if (
      role === 'family' &&
      /(aujourd hui|today|demain|tomorrow)/.test(normalized)
    ) {
      return false;
    }

    return (
      this.isHelpIntent(message) ||
      /(what does|what is|que signifie|definition|meaning|a quoi correspond)/.test(
        normalized,
      )
    );
  }

  private compactHistory(
    history: ChatMessage[],
    maxItems: number,
  ): ChatMessage[] {
    const compacted: ChatMessage[] = [];

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index];
      const content = String(item.content ?? '').trim();
      if (!content) {
        continue;
      }
      if (item.role === 'model' && content.length > 320) {
        continue;
      }
      compacted.unshift({ role: item.role, content });
      if (compacted.length >= maxItems) {
        break;
      }
    }

    return compacted;
  }

  private normalizeQuestion(message: string): string {
    return message
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildCacheKey(
    role: string,
    message: string,
    context: AssistantContext,
  ): string {
    const normalized = this.normalizeQuestion(message);
    return [
      role,
      context.locale ?? 'fr',
      context.surface ?? 'unknown',
      context.route ?? 'unknown',
      normalized,
      this.buildContextSignature(context.uiContext),
    ].join('|');
  }

  private buildContextSignature(value: unknown, depth = 0): string {
    if (value == null) {
      return '';
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, 5)
        .map((item) => this.buildContextSignature(item, depth + 1))
        .join(',');
    }
    if (typeof value === 'object' && depth < 2) {
      return Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 8)
        .map(
          ([key, entry]) =>
            `${key}:${this.buildContextSignature(entry, depth + 1)}`,
        )
        .join('|');
    }
    return '';
  }

  private readCachedReply(
    cacheKey: string | undefined,
    forceRefresh: boolean | undefined,
  ): CachedAssistantReply | null {
    if (!cacheKey || forceRefresh === true) {
      return null;
    }

    const cached = this.assistantCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    const ageMs = Date.now() - new Date(cached.generatedAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > this.assistantCacheTtlMs) {
      this.assistantCache.delete(cacheKey);
      return null;
    }

    return cached;
  }

  private writeCachedReply(
    cacheKey: string | undefined,
    reply: string,
    meta: AssistantResponseMeta,
  ): void {
    if (!cacheKey || meta.complexity !== 'simple') {
      return;
    }

    this.assistantCache.set(cacheKey, {
      reply,
      generatedAt: meta.generatedAt,
      reason: meta.reason,
    });

    while (this.assistantCache.size > this.assistantCacheMaxEntries) {
      const oldestKey: string | undefined = this.assistantCache
        .keys()
        .next().value;
      if (!oldestKey) {
        break;
      }
      this.assistantCache.delete(oldestKey);
    }
  }

  private buildMeta(
    strategy: AssistantRoutingStrategy,
    complexity: 'simple' | 'complex',
    reason: string,
    overrides: Partial<AssistantResponseMeta> = {},
  ): AssistantResponseMeta {
    return {
      strategy,
      complexity,
      refreshed: false,
      cacheHit: strategy === 'cached',
      generatedAt: new Date().toISOString(),
      reason,
      ...overrides,
    };
  }

  private buildChatResponse(
    reply: string,
    meta: AssistantResponseMeta,
    pendingAction?: PendingAssistantAction,
  ): ChatbotChatResponse {
    this.recordRoutingDecision(meta);
    return {
      reply,
      pendingAction,
      meta,
    };
  }

  private recordRoutingDecision(meta: AssistantResponseMeta): void {
    const key = `${meta.strategy}:${meta.reason}`;
    const nextCount = (this.routingCounters.get(key) ?? 0) + 1;
    this.routingCounters.set(key, nextCount);

    if (nextCount === 1 || nextCount % 10 === 0) {
      this.logger.debug(
        `Assistant routing ${meta.strategy} (${meta.reason}) count=${nextCount}`,
      );
    }
  }

  private buildPrepareRoutineTaskTool() {
    return {
      type: 'function',
      function: {
        name: 'prepare_routine_task',
        description:
          "Prépare l'ajout d'une nouvelle tâche ou d'un rappel dans la routine quotidienne de l'enfant. Utilise cet outil seulement si l'utilisateur demande clairement la création d'une tâche ou d'un rappel.",
        parameters: {
          type: 'object',
          properties: {
            childId: {
              type: 'string',
              description:
                "ID de l'enfant concerné. Choisis uniquement un ID présent dans la liste fournie dans le prompt système.",
            },
            title: {
              type: 'string',
              description: 'Titre court et clair de la tâche à créer.',
            },
            description: {
              type: 'string',
              description: 'Courte précision optionnelle sur la tâche.',
            },
            time: {
              type: 'string',
              description: "Heure au format HH:mm, par exemple '09:30'.",
            },
          },
          required: ['childId', 'title', 'time'],
        },
      },
    };
  }

  private async preparePendingAction(
    userId: string,
    role: string,
    toolCall: {
      function?: { name?: string; arguments?: string };
    },
    children: unknown[],
    locale: AssistantLocale,
  ): Promise<PendingAssistantAction | null> {
    if (toolCall.function?.name !== 'prepare_routine_task') {
      return null;
    }

    const rawArgs = toolCall.function.arguments;
    if (!rawArgs) {
      return null;
    }

    let args: {
      childId?: string;
      title?: string;
      description?: string;
      time?: string;
    };
    try {
      args = JSON.parse(rawArgs) as {
        childId?: string;
        title?: string;
        description?: string;
        time?: string;
      };
    } catch {
      throw new BadRequestException('Assistant action payload is invalid');
    }

    const childId = String(args.childId ?? '').trim();
    const title = String(args.title ?? '').trim();
    const description = String(args.description ?? '').trim();
    const time = this.normalizeTime(args.time);

    if (!childId || !title || !time) {
      throw new BadRequestException(
        'Assistant action is missing required fields',
      );
    }

    const matchingChild = children.find((entry: unknown) => {
      const child = entry as {
        _id?: { toString(): string };
        id?: { toString(): string };
      };
      return (
        child._id?.toString?.() === childId ||
        child.id?.toString?.() === childId
      );
    }) as { fullName?: string } | undefined;
    if (!matchingChild) {
      throw new BadRequestException('Assistant selected an unknown child');
    }

    await this.childAccessService.assertCanAccessChild(childId, userId);

    const confirmToken = await this.jwtService.signAsync(
      {
        kind: 'chatbot-confirm',
        userId,
        role,
        locale,
        action: {
          type: 'create_task_reminder',
          childId,
          title,
          description: description || undefined,
          time,
        },
      } satisfies PendingActionTokenPayload,
      {
        secret: this.chatbotConfirmSecret,
        expiresIn: '10m',
      },
    );

    return {
      type: 'create_task_reminder',
      label: this.translateLiteral(
        locale,
        'Confirmer le rappel',
        'Confirm reminder',
        'تأكيد التذكير',
      ),
      description: this.translateLiteral(
        locale,
        `Créer un rappel "${title}" à ${time} pour ${matchingChild.fullName ?? 'cet enfant'}.`,
        `Create reminder "${title}" at ${time} for ${matchingChild.fullName ?? 'this child'}.`,
        `إنشاء تذكير "${title}" عند ${time} للطفل ${matchingChild.fullName ?? 'هذا الطفل'}.`,
      ),
      confirmToken,
      preview: {
        childId,
        childName:
          matchingChild.fullName ??
          this.translateLiteral(locale, 'Enfant', 'Child', 'الطفل'),
        title,
        description: description || undefined,
        time,
        frequency: ReminderFrequency.ONCE,
        reminderType: ReminderType.CUSTOM,
      },
    };
  }

  private normalizeTime(time: string | undefined): string {
    const value = String(time ?? '').trim();
    if (!/^\d{2}:\d{2}$/.test(value)) {
      throw new BadRequestException('Assistant action time must use HH:mm');
    }
    const [hoursRaw, minutesRaw] = value.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      throw new BadRequestException('Assistant action time is invalid');
    }
    return value;
  }

  private async confirmCreateTaskReminder(
    userId: string,
    action: PendingActionTokenPayload['action'],
    locale: AssistantLocale = 'fr',
  ): Promise<ChatbotConfirmResponse> {
    const access = await this.childAccessService.assertCanAccessChild(
      action.childId,
      userId,
    );

    const reminder = await this.remindersService.create(
      {
        childId: action.childId,
        type: ReminderType.CUSTOM,
        title: action.title,
        description: action.description,
        frequency: ReminderFrequency.ONCE,
        times: [action.time],
        icon: '📅',
        color: '#A7DBE6',
        soundEnabled: true,
        vibrationEnabled: true,
      } satisfies CreateTaskReminderDto,
      userId,
    );

    const childName =
      access.child.fullName ??
      this.translateLiteral(locale, 'votre enfant', 'your child', 'طفلك');
    const summary = this.translateLiteral(
      locale,
      `Rappel "${action.title}" créé à ${action.time} pour ${childName}.`,
      `Reminder "${action.title}" created at ${action.time} for ${childName}.`,
      `تم إنشاء التذكير "${action.title}" عند ${action.time} للطفل ${childName}.`,
    );
    return {
      reply: this.translateLiteral(
        locale,
        `C'est fait. ${summary}`,
        `Done. ${summary}`,
        `تم التنفيذ. ${summary}`,
      ),
      execution: {
        type: 'create_task_reminder',
        status: 'confirmed',
        entityId:
          reminder &&
          typeof reminder === 'object' &&
          'id' in reminder &&
          typeof reminder.id === 'string'
            ? reminder.id
            : undefined,
        summary,
      },
    };
  }

  private extractReplyContent(responseMessage: unknown): string {
    const content = String(
      (responseMessage as { content?: string | null }).content ?? '',
    ).trim();
    return content || "Je n'ai rien à ajouter pour le moment.";
  }

  private buildReadOnlyFallbackReply(
    userName: string,
    role: string,
    context: AssistantContext,
    locale: AssistantLocale,
  ): string {
    const route =
      context.route ??
      this.translateLiteral(
        locale,
        'ce tableau de bord',
        'this dashboard',
        'لوحة التحكم هذه',
      );
    const contextBits =
      this.buildReadOnlyContextSummary(
        role,
        context.route,
        context.uiContext,
      ) ?? this.summarizeUiContext(context.uiContext);
    return this.translateLiteral(
      locale,
      `${userName}, l'assistant IA est momentanément indisponible pour le rôle ${role}. Sur ${route}, voici l'essentiel que je peux confirmer: ${contextBits}`,
      `${userName}, the AI assistant is temporarily unavailable for role ${role}. On ${route}, here is what I can safely confirm: ${contextBits}`,
      `${userName}، مساعد الذكاء الاصطناعي غير متاح مؤقتًا للدور ${role}. على ${route}، هذا أهم ما يمكنني تأكيده: ${contextBits}`,
    );
  }

  private summarizeUiContext(
    uiContext: Record<string, unknown> | undefined,
  ): string {
    if (!uiContext || Object.keys(uiContext).length === 0) {
      return 'aucun contexte supplémentaire n’a été transmis.';
    }

    const summaries: string[] = [];
    for (const [key, value] of Object.entries(uiContext)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        summaries.push(`${key}: ${value}`);
        continue;
      }
      if (Array.isArray(value)) {
        const items = value
          .filter((entry) => typeof entry === 'string')
          .slice(0, 2)
          .join(', ');
        if (items) {
          summaries.push(`${key}: ${items}`);
        }
        continue;
      }
      if (value && typeof value === 'object') {
        const nestedKeys = Object.keys(value).slice(0, 4);
        if (nestedKeys.length > 0) {
          summaries.push(`${key}: ${nestedKeys.join(', ')}`);
        }
      }
      if (summaries.length >= 4) {
        break;
      }
    }

    return summaries.length > 0
      ? `${summaries.join(' ; ')}.`
      : 'le contexte transmis est partiel mais disponible dans le tableau de bord.';
  }

  private describeFamilyRoute(
    route: string | undefined,
    locale: AssistantLocale,
  ): string {
    const value = String(route ?? '').toLowerCase();
    if (value.includes('routine') || value.includes('schedule')) {
      return this.translateLiteral(
        locale,
        'votre espace routine et rappels',
        'your routine and reminders area',
        'مساحة الروتين والتذكيرات الخاصة بك',
      );
    }
    if (value.includes('progress')) {
      return this.translateLiteral(
        locale,
        'votre vue progrès',
        'your progress view',
        'واجهة التقدم الخاصة بك',
      );
    }
    if (value.includes('home')) {
      return this.translateLiteral(
        locale,
        'votre accueil famille',
        'your family home',
        'الواجهة الرئيسية للعائلة',
      );
    }
    return this.translateLiteral(
      locale,
      'cette interface famille',
      'this family interface',
      'واجهة العائلة الحالية',
    );
  }

  private describeDashboardRoute(
    route: string | undefined,
    role: string,
    locale: AssistantLocale,
  ): string {
    const value = String(route ?? '').toLowerCase();
    if (value.includes('/admin')) {
      return this.translateLiteral(
        locale,
        'le tableau de bord admin',
        'the admin dashboard',
        'لوحة تحكم الإدارة',
      );
    }
    if (value.includes('/org')) {
      return this.translateLiteral(
        locale,
        'le tableau de bord organisation',
        'the organization dashboard',
        'لوحة تحكم المنظمة',
      );
    }
    if (value.includes('/specialist')) {
      return this.translateLiteral(
        locale,
        'le tableau de bord spécialiste',
        'the specialist dashboard',
        'لوحة تحكم المختص',
      );
    }
    return this.translateLiteral(
      locale,
      `le tableau de bord ${role}`,
      `${role} dashboard`,
      `لوحة تحكم ${role}`,
    );
  }

  private extractChildName(child: unknown): string {
    const value = child as { fullName?: string };
    return String(value.fullName ?? 'votre enfant');
  }

  private getLocale(context: AssistantContext): AssistantLocale {
    return context.locale === 'ar' || context.locale === 'en'
      ? context.locale
      : 'fr';
  }

  private translateLiteral(
    locale: AssistantLocale,
    fr: string,
    en: string,
    ar: string,
  ): string {
    if (locale === 'ar') return ar;
    if (locale === 'en') return en;
    return fr;
  }

  private outputLanguageRule(locale: AssistantLocale): string {
    if (locale === 'ar') {
      return 'Réponds strictement en arabe uniquement. N’utilise pas le français ni l’anglais.';
    }
    if (locale === 'en') {
      return 'Reply strictly in English only. Do not switch to French or Arabic.';
    }
    return 'Réponds strictement en français uniquement. N’utilise pas l’anglais ni l’arabe.';
  }

  private enforceReplyLocale(reply: string, locale: AssistantLocale): string {
    const trimmed = String(reply ?? '').trim();
    if (!trimmed) {
      return this.translateLiteral(
        locale,
        "Je n'ai rien à ajouter pour le moment.",
        "I don't have anything to add right now.",
        'ليس لدي إضافة الآن.',
      );
    }
    if (locale === 'ar' && !/[\u0600-\u06FF]/.test(trimmed)) {
      return 'أعتذر، سأجيب بالعربية فقط. يرجى إعادة صياغة السؤال إن أردت.';
    }
    return trimmed;
  }

  private buildPendingReminderReply(
    pendingAction: PendingAssistantAction,
    locale: AssistantLocale,
  ): string {
    return this.translateLiteral(
      locale,
      `Je peux créer ce rappel pour ${pendingAction.preview.childName} à ${pendingAction.preview.time}. Vérifiez les détails puis confirmez si tout est correct.`,
      `I can create this reminder for ${pendingAction.preview.childName} at ${pendingAction.preview.time}. Review the details and confirm if everything looks correct.`,
      `يمكنني إنشاء هذا التذكير للطفل ${pendingAction.preview.childName} عند ${pendingAction.preview.time}. راجع التفاصيل ثم أكد إذا كان كل شيء صحيحًا.`,
    );
  }
}
