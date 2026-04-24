import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  FamilyRoutinePreferences,
  FamilyRoutinePreferencesDocument,
} from './schemas/family-routine-preferences.schema';
import { RemindersService } from '../nutrition/reminders.service';
import { ChildrenService } from '../children/children.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GenerateDailyScheduleDto } from './dto/generate-daily-schedule.dto';
import { UpdateFamilyRoutinePreferencesDto } from './dto/update-family-routine-preferences.dto';
import { ConfirmDailyScheduleDto } from './dto/confirm-daily-schedule.dto';

export interface DailyScheduleSlotDto {
  time: string;
  label: string;
  category: string;
  highlight?: boolean;
}

export interface DailyScheduleResponseDto {
  date: string;
  childId: string;
  childName: string;
  summary: string;
  weatherSummary: string;
  weatherAdaptation: string;
  temperatureMaxC?: number;
  precipitationProbability?: number;
  weatherCode?: number;
  slots: DailyScheduleSlotDto[];
  followUpQuestion?: string | null;
  followUpOptions?: string[];
  source: 'ai' | 'fallback';
}

interface WeatherDay {
  summary: string;
  adaptation: string;
  temperatureMaxC?: number;
  precipitationProbability?: number;
  weatherCode?: number;
}

const DEFAULT_LAT = 36.8065;
const DEFAULT_LNG = 10.1815;

@Injectable()
export class FamilyDailyScheduleService {
  private readonly logger = new Logger(FamilyDailyScheduleService.name);
  private readonly groqApiKey = process.env.GROQ_API_KEY;
  private readonly openaiApiKey = process.env.OPENAI_API_KEY;

  constructor(
    @InjectModel(FamilyRoutinePreferences.name)
    private readonly prefsModel: Model<FamilyRoutinePreferencesDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly remindersService: RemindersService,
    private readonly childrenService: ChildrenService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async assertFamilyOwnsChild(
    userId: string,
    childId: string,
  ): Promise<{ fullName: string }> {
    const children = await this.childrenService.findByFamilyId(userId, userId);
    const c = children.find((ch) => ch.id === childId);
    if (!c) {
      throw new ForbiddenException('Child not found or not your family');
    }
    return { fullName: c.fullName };
  }

  async getPreferences(userId: string, childId?: string) {
    const q: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (childId) {
      q.childId = new Types.ObjectId(childId);
    } else {
      q.childId = { $exists: false };
    }
    let doc = await this.prefsModel.findOne(q).lean().exec();
    if (!doc && childId) {
      doc = await this.prefsModel
        .findOne({
          userId: new Types.ObjectId(userId),
          childId: { $exists: false },
        })
        .lean()
        .exec();
    }
    return {
      wakeTime: doc?.wakeTime ?? '07:00',
      sleepTime: doc?.sleepTime ?? '21:00',
      lunchTime: doc?.lunchTime ?? '12:30',
      notes: doc?.notes ?? '',
      childId: childId ?? null,
    };
  }

  async upsertPreferences(
    userId: string,
    dto: UpdateFamilyRoutinePreferencesDto,
  ) {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (dto.childId) {
      filter.childId = new Types.ObjectId(dto.childId);
    } else {
      filter.childId = { $exists: false };
    }
    const set: Record<string, unknown> = {};
    if (dto.wakeTime !== undefined) set.wakeTime = dto.wakeTime;
    if (dto.sleepTime !== undefined) set.sleepTime = dto.sleepTime;
    if (dto.lunchTime !== undefined) set.lunchTime = dto.lunchTime;
    if (dto.notes !== undefined) set.notes = dto.notes;
    await this.prefsModel
      .findOneAndUpdate(
        filter,
        {
          $set: set,
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            ...(dto.childId
              ? { childId: new Types.ObjectId(dto.childId) }
              : {}),
          },
        },
        { upsert: true, new: true },
      )
      .exec();
    return this.getPreferences(userId, dto.childId);
  }

  async confirmPlan(userId: string, dto: ConfirmDailyScheduleDto) {
    await this.assertFamilyOwnsChild(userId, dto.childId);
    return this.upsertPreferences(userId, {
      childId: dto.childId,
      wakeTime: dto.wakeTime,
      sleepTime: dto.sleepTime,
      lunchTime: dto.lunchTime,
    });
  }

  private async fetchWeather(
    lat: number,
    lng: number,
    dateIso: string,
  ): Promise<WeatherDay> {
    try {
      const url =
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${lat}&longitude=${lng}` +
        '&daily=weather_code,temperature_2m_max,precipitation_probability_max' +
        '&timezone=auto' +
        `&start_date=${dateIso}&end_date=${dateIso}`;
      const { data } = await axios.get<{
        daily?: {
          time?: string[];
          weather_code?: number[];
          temperature_2m_max?: number[];
          precipitation_probability_max?: number[];
        };
      }>(url, { timeout: 12000 });
      const times = data.daily?.time ?? [];
      const idx = times.indexOf(dateIso);
      if (idx < 0) {
        return {
          summary: 'Météo indisponible pour cette date.',
          adaptation: '',
        };
      }
      const code = data.daily?.weather_code?.[idx] ?? 0;
      const tmax = data.daily?.temperature_2m_max?.[idx];
      const p = data.daily?.precipitation_probability_max?.[idx];
      const summary = this.weatherCodeToFrench(code, tmax, p);
      let adaptation = '';
      if ((p ?? 0) >= 50 || this.isRainCode(code)) {
        adaptation =
          'Pluie possible : privilégiez des activités calmes en intérieur (jeux sensoriels, lecture).';
      } else if (this.isClearCode(code)) {
        adaptation =
          'Beau temps prévu : une courte sortie ou activité en plein air peut être envisagée si l’enfant y est réceptif.';
      } else {
        adaptation =
          'Conditions mitigées : adaptez les activités au ressenti de l’enfant.';
      }
      return {
        summary,
        adaptation,
        temperatureMaxC: tmax,
        precipitationProbability: p,
        weatherCode: code,
      };
    } catch (e: unknown) {
      this.logger.warn(`Weather fetch failed: ${(e as Error)?.message}`);
      return {
        summary: 'Météo temporairement indisponible.',
        adaptation: '',
      };
    }
  }

  private isRainCode(code: number): boolean {
    return (
      (code >= 51 && code <= 67) ||
      (code >= 80 && code <= 82) ||
      code === 95 ||
      code === 96 ||
      code === 99
    );
  }

  private isClearCode(code: number): boolean {
    return code === 0 || code === 1 || code === 2;
  }

  private weatherCodeToFrench(code: number, tmax?: number, p?: number): string {
    const parts: string[] = [];
    if (tmax !== undefined && !Number.isNaN(tmax)) {
      parts.push(`Température max. environ ${Math.round(tmax)}°C.`);
    }
    if (p !== undefined && !Number.isNaN(p)) {
      parts.push(`Risque de pluie : ${p}%.`);
    }
    let sky = '';
    if (code === 0) sky = 'Ciel dégagé.';
    else if (code <= 3) sky = 'Partiellement nuageux.';
    else if (this.isRainCode(code)) sky = 'Averses ou pluie possibles.';
    else if (code >= 71 && code <= 77) sky = 'Neige possible.';
    else if (code >= 45 && code <= 48) sky = 'Brouillard possible.';
    else sky = 'Conditions variables.';
    parts.push(sky);
    return parts.join(' ');
  }

  private buildFallbackSlots(
    reminders: Array<{
      title: string;
      times?: string[];
      type?: string;
      frequency?: string;
    }>,
    appointments: Array<{ time: string; title: string; subtitle?: string }>,
    prefs: { wakeTime: string; sleepTime: string; lunchTime: string },
    weather: WeatherDay,
  ): DailyScheduleSlotDto[] {
    const slots: DailyScheduleSlotDto[] = [];
    const add = (
      time: string,
      label: string,
      category: string,
      highlight = false,
    ) => {
      slots.push({ time, label, category, highlight });
    };

    add(prefs.wakeTime, 'Réveil & routine du matin', 'wake');
    add(this.addMinutes(prefs.wakeTime, 45), 'Petit-déjeuner', 'meal');
    add('10:00', 'Pause / temps calme', 'rest');

    for (const a of appointments) {
      add(
        a.time,
        a.subtitle ? `${a.title} — ${a.subtitle}` : a.title,
        'therapy',
        true,
      );
    }

    for (const r of reminders) {
      const times = r.times ?? [];
      for (const t of times) {
        const hl =
          r.type === 'medication' ||
          /thérap|ortho|ergo|psy|médic|rdv/i.test(r.title);
        add(t, r.title, 'activity', hl);
      }
      if (r.frequency === 'interval' && times.length === 0) {
        add('12:00', `${r.title} (selon intervalle)`, 'activity', false);
      }
    }

    add(prefs.lunchTime, 'Déjeuner', 'meal');
    add('15:30', 'Goûter / pause', 'rest');
    add('18:30', 'Dîner', 'meal');
    add('19:30', 'Routine du soir (calme)', 'evening');
    add(prefs.sleepTime, 'Coucher', 'sleep');

    if (weather.adaptation) {
      add('11:00', `Conseil météo : ${weather.adaptation}`, 'other', false);
    }

    slots.sort((a, b) => a.time.localeCompare(b.time));
    return slots;
  }

  private addMinutes(hhmm: string, mins: number): string {
    const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return '08:00';
    let total = h * 60 + m + mins;
    total = Math.min(23 * 60 + 59, Math.max(0, total));
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    return `${nh.toString().padStart(2, '0')}:${nm.toString().padStart(2, '0')}`;
  }

  private parseAiJson(content: string): Record<string, unknown> | null {
    let s = content.trim();
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/s, '');
    }
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async callLlmJson(system: string, user: string): Promise<string> {
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];
    const bodyBase = {
      messages,
      max_tokens: 2048,
      temperature: 0.45,
      response_format: { type: 'json_object' },
    };

    if (this.groqApiKey) {
      const r = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          ...bodyBase,
        },
        {
          timeout: 45000,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.groqApiKey}`,
          },
        },
      );
      const c = (
        r.data as { choices?: Array<{ message?: { content?: string } }> }
      )?.choices?.[0]?.message?.content;
      if (c) return c;
    }

    if (this.openaiApiKey) {
      const r = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          ...bodyBase,
        },
        {
          timeout: 45000,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.openaiApiKey}`,
          },
        },
      );
      const c = (
        r.data as { choices?: Array<{ message?: { content?: string } }> }
      )?.choices?.[0]?.message?.content;
      if (c) return c;
    }

    throw new Error('NO_AI_KEY');
  }

  async generate(
    userId: string,
    dto: GenerateDailyScheduleDto,
  ): Promise<DailyScheduleResponseDto> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    const child = await this.assertFamilyOwnsChild(userId, dto.childId);
    const prefs = await this.getPreferences(userId, dto.childId);
    const userDoc = await this.userModel
      .findById(userId)
      .select('locationLat locationLng')
      .lean()
      .exec();
    const lat =
      typeof userDoc?.locationLat === 'number'
        ? userDoc.locationLat
        : DEFAULT_LAT;
    const lng =
      typeof userDoc?.locationLng === 'number'
        ? userDoc.locationLng
        : DEFAULT_LNG;

    const reminders = await this.remindersService.getRemindersForCalendarDate(
      dto.childId,
      userId,
      dto.date,
    );

    const weather = await this.fetchWeather(lat, lng, dto.date);

    const reminderLines = reminders
      .map((r) => {
        const t = (r.times ?? []).join(', ');
        return `- [${r.type}] ${r.title}${t ? ` @ ${t}` : ''} (${r.frequency})`;
      })
      .join('\n');

    const apptLines =
      dto.appointments
        ?.map(
          (a) =>
            `- ${a.time} — ${a.title}${a.subtitle ? ` (${a.subtitle})` : ''}`,
        )
        .join('\n') ?? '(aucun)';

    const hist = dto.conversationHistory?.trim();
    const histBlock =
      hist && hist.length > 0
        ? `Historique de la conversation (respecte ce fil, ne te répète pas inutilement) :\n${hist.slice(0, 8000)}\n\n`
        : '';

    const userPrompt = `Date du plan : ${dto.date}
Enfant : ${child.fullName}
Préférences famille : réveil ${prefs.wakeTime}, déjeuner ${prefs.lunchTime}, coucher ${prefs.sleepTime}.
${prefs.notes ? `Notes récurrentes parent : ${prefs.notes}\n` : ''}
Météo : ${weather.summary}
${weather.adaptation ? `Adaptation suggérée : ${weather.adaptation}\n` : ''}
Rappels / routines prévus ce jour-là :
${reminderLines || '(aucun)'}

Rendez-vous additionnels (calendrier) :
${apptLines}

${histBlock}${dto.userNotes ? `Dernier message du parent (à intégrer) : ${dto.userNotes}\n` : ''}
${dto.followUpContext ? `Choix / réponse du parent (suite dialogue) : ${dto.followUpContext}\n` : ''}

Produis un JSON avec exactement ces clés :
- "summary" (string, 2-4 phrases en français, ton bienveillant)
- "weatherAdaptation" (string, court, comment ajuster la journée avec la météo)
- "slots" : tableau d'objets { "time": "HH:mm", "label": string, "category": "wake"|"meal"|"activity"|"therapy"|"rest"|"evening"|"sleep"|"other", "highlight": boolean optionnel pour RDV importants }
- "followUpQuestion" : string ou null — une seule question courte si une info manque (ex. horaire école), sinon null
- "followUpOptions" : tableau de 2 à 4 réponses courtes si followUpQuestion est posée, sinon []

Le planning doit couvrir réveil, matin, repas, activités (école/thérapie/tâches), pauses, soir, coucher. Intègre les rappels aux bons horaires.`;

    const system = `Tu es un assistant conversationnel "spécialiste planning" pour familles d'enfants à besoins spéciaux (CogniCare).
Si l'historique montre un conflit d'horaire ou une ambiguïté, tu peux poser UNE question courte dans followUpQuestion avec 2 à 4 options dans followUpOptions.
Le champ "summary" doit sonner comme une réponse naturelle au parent (tu peux mentionner un conflit, une proposition de décaler une séance, etc.).
Tu réponds UNIQUEMENT par un objet JSON valide, sans markdown.`;

    let source: 'ai' | 'fallback' = 'fallback';
    let summary = `Voici une proposition de journée pour ${child.fullName} le ${dto.date}.`;
    let weatherAdaptation = weather.adaptation;
    let slots: DailyScheduleSlotDto[] = [];
    let followUpQuestion: string | null = null;
    let followUpOptions: string[] = [];

    try {
      if (this.groqApiKey || this.openaiApiKey) {
        const raw = await this.callLlmJson(system, userPrompt);
        const parsed = this.parseAiJson(raw);
        if (parsed && Array.isArray(parsed.slots)) {
          slots = (parsed.slots as unknown[])
            .map((x) => {
              const o = x as Record<string, unknown>;
              return {
                time: String(
                  (o.time as string | number | undefined) ?? '12:00',
                ).slice(0, 5),
                label: String((o.label as string | number | undefined) ?? ''),
                category: String(
                  (o.category as string | number | undefined) ?? 'activity',
                ),
                highlight: Boolean(o.highlight),
              };
            })
            .filter((s) => s.label.length > 0);
          slots.sort((a, b) => a.time.localeCompare(b.time));
          if (typeof parsed.summary === 'string') summary = parsed.summary;
          if (typeof parsed.weatherAdaptation === 'string') {
            weatherAdaptation = parsed.weatherAdaptation;
          }
          if (
            parsed.followUpQuestion &&
            typeof parsed.followUpQuestion === 'string'
          ) {
            followUpQuestion = parsed.followUpQuestion;
          }
          if (Array.isArray(parsed.followUpOptions)) {
            followUpOptions = (parsed.followUpOptions as unknown[])
              .map((x) => String(x))
              .filter(Boolean);
          }
          source = 'ai';
        }
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message;
      if (msg !== 'NO_AI_KEY') {
        this.logger.warn(`AI schedule failed: ${msg}`);
      }
    }

    if (slots.length === 0) {
      slots = this.buildFallbackSlots(
        reminders,
        dto.appointments ?? [],
        prefs,
        weather,
      );
    }

    const out: DailyScheduleResponseDto = {
      date: dto.date,
      childId: dto.childId,
      childName: child.fullName,
      summary,
      weatherSummary: weather.summary,
      weatherAdaptation,
      temperatureMaxC: weather.temperatureMaxC,
      precipitationProbability: weather.precipitationProbability,
      weatherCode: weather.weatherCode,
      slots,
      followUpQuestion,
      followUpOptions,
      source,
    };

    if (dto.createNotification) {
      const short =
        summary.length > 220 ? `${summary.slice(0, 217)}…` : summary;
      await this.notificationsService.createForUser(userId, {
        type: 'daily_schedule',
        title: `Planning du ${dto.date} — ${child.fullName}`,
        description: short,
        data: {
          childId: dto.childId,
          date: dto.date,
          slotCount: slots.length,
        },
      });
    }

    return out;
  }
}
