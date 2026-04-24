import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { Reel, ReelDocument } from './reel.schema';
import {
  ReelEngagement,
  ReelEngagementDocument,
} from './reel-engagement.schema';

/** Instances Invidious (gratuit, sans clé). On essaie la première puis les suivantes si échec. */
const INVIDIOUS_INSTANCES = [
  'https://vid.puffyan.us',
  'https://invidious.flokinet.to',
  'https://inv.riverside.rocks',
  'https://invidious.nerdvpn.de',
];

/**
 * Mots-clés stricts : maladies et troubles **cognitifs** (démence, mémoire, neurodégénérescence).
 * Sert à scorer et filtrer Invidious + Dailymotion ; pas de thèmes hors secteur (ex. autisme seul).
 */
const COGNITIVE_DISEASE_KEYWORDS = [
  'alzheimer',
  'alzheimers',
  'démence',
  'dementia',
  'lévy',
  'lewy',
  'parkinson',
  'cognitif',
  'cognitive',
  'trouble cognitif',
  'cognitive impairment',
  'mild cognitive',
  ' mci ',
  'mci —',
  'mci -',
  'trouble cognitif léger',
  'neurodégéné',
  'neurodegener',
  'neuropsycholog',
  'memory loss',
  'memory and',
  'brain health',
  'santé cérébrale',
  'déclin cognitif',
  'cognitive decline',
  'vieillissement cognitif',
  'aging brain',
  'précoce',
  'early onset',
  'aidant',
  'caregiver',
  'aidance',
  'dementia care',
  'soins démence',
];

interface InvidiousSearchItem {
  type?: string;
  title?: string;
  videoId?: string;
  description?: string;
  videoThumbnails?: Array<{ quality?: string; url?: string }>;
  published?: number;
  lengthSeconds?: number;
}

/** Réponse API Dailymotion (gratuite, sans clé). */
interface DailymotionVideo {
  id?: string;
  title?: string;
  description?: string;
  thumbnail_240_url?: string;
  created_time?: number;
  duration?: number;
}

/** Liste de secours : IDs courts YouTube pertinents maladies cognitives (optionnel, souvent vide). */
const SEED_YOUTUBE_IDS: string[] = [];

/** Réponse oEmbed TikTok (https://www.tiktok.com/oembed). */
interface TikTokOEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

/**
 * IDs YouTube à exclure (embed bloqué erreur 153, contenu hors santé cognitive, etc.).
 * ex. kffacxfA7G4 = « Baby » — lecture in-app impossible sur beaucoup d’appareils.
 */
const BLOCKED_YOUTUBE_IDS = ['kffacxfA7G4'];

@Injectable()
export class ReelsService {
  private readonly logger = new Logger(ReelsService.name);

  constructor(
    @InjectModel(Reel.name) private reelModel: Model<ReelDocument>,
    @InjectModel(ReelEngagement.name)
    private engagementModel: Model<ReelEngagementDocument>,
    private config: ConfigService,
  ) {}

  /** Filtre Mongo : masque les YouTube blocklistés (API + cohérent avec suppression DB). */
  private listVisibilityFilter() {
    return {
      $or: [
        { source: { $ne: 'youtube' } },
        { sourceId: { $nin: BLOCKED_YOUTUBE_IDS } },
      ],
    };
  }

  /**
   * Supprime de la base les reels problématiques / hors charte (appelé au refresh et manuellement).
   */
  async purgeBlockedReels(): Promise<{ removed: number }> {
    const byId = await this.reelModel
      .deleteMany({
        source: 'youtube',
        sourceId: { $in: BLOCKED_YOUTUBE_IDS },
      })
      .exec();
    const removed = byId.deletedCount ?? 0;
    if (removed > 0) {
      this.logger.log(
        `Reels purge: removed ${removed} blocked YouTube reel(s)`,
      );
    }
    return { removed };
  }

  /**
   * Liste les reels pour l'app (paginated).
   */
  async list(
    page = 1,
    limit = 20,
  ): Promise<{
    reels: Reel[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    const filter = this.listVisibilityFilter();
    const [reels, total] = await Promise.all([
      this.reelModel
        .find(filter)
        .sort({ relevanceScore: -1, publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.reelModel.countDocuments(filter).exec(),
    ]);
    return {
      reels: reels as Reel[],
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Score de pertinence (titre + description) pour le **secteur maladies cognitives** uniquement.
   */
  private keywordRelevanceScore(title: string, description: string): number {
    const text = `${(title || '').toLowerCase()} ${(description || '').toLowerCase()}`;
    let hits = 0;
    for (const kw of COGNITIVE_DISEASE_KEYWORDS) {
      if (text.includes(kw.toLowerCase())) hits++;
    }
    if (hits === 0) return 0;
    return Math.min(1, 0.35 + hits * 0.12);
  }

  /**
   * Récupère des shorts via Invidious (scrape, gratuit).
   * Recherche par mots-clés troubles cognitifs / autisme, enregistre en base.
   */
  /**
   * Rafraîchissement Invidious + Dailymotion. Alterne le tri (récent vs pertinence) selon le jour
   * pour récupérer davantage de **nouvelles** vidéos au fil du temps.
   */
  async refreshFromYoutube(): Promise<{ added: number; skipped: number }> {
    await this.purgeBlockedReels();

    const customBase = this.config.get<string>('INVIDIOUS_BASE_URL');
    const bases = customBase
      ? [customBase.replace(/\/$/, '')]
      : INVIDIOUS_INSTANCES;

    let added = 0;
    let skipped = 0;

    /** Alternance quotidienne : favorise les uploads récents un jour sur deux. */
    const dayIndex = Math.floor(Date.now() / 86_400_000);
    const sortBy = dayIndex % 2 === 0 ? 'upload_date' : 'relevance';
    /** Page de résultats Invidious (1–3) pour varier les vidéos d’un jour à l’autre. */
    const searchPage = (dayIndex % 3) + 1;

    const queries = [
      'Alzheimer maladie',
      'dementia awareness',
      'troubles cognitifs légers',
      'mild cognitive impairment',
      'démence personne âgée',
      'neuropsychologie mémoire',
      'cognitive decline aging',
      'MCI memory health',
      'aidant Alzheimer',
    ];

    for (const q of queries) {
      let items: InvidiousSearchItem[] = [];
      for (const base of bases) {
        const searchUrl = `${base}/api/v1/search`;
        try {
          const { data } = await axios.get<InvidiousSearchItem[]>(searchUrl, {
            params: {
              q,
              type: 'video',
              duration: 'short',
              sort_by: sortBy,
              page: searchPage,
            },
            timeout: 12000,
            validateStatus: () => true,
            headers: {
              'User-Agent': 'CogniCare-Reels/1.0 (Family app)',
              Accept: 'application/json',
            },
          });
          if (typeof data === 'object' && Array.isArray(data)) {
            items = data;
            break;
          }
        } catch (err) {
          this.logger.warn(`Invidious ${base} search "${q}" failed: ${err}`);
          continue;
        }
      }
      // Si aucune instance ne renvoie de shorts, essayer sans filtre durée et garder les courtes (< 90 s).
      if (items.length === 0) {
        for (const base of bases) {
          const searchUrl = `${base}/api/v1/search`;
          try {
            const { data } = await axios.get<InvidiousSearchItem[]>(searchUrl, {
              params: {
                q,
                type: 'video',
                sort_by: sortBy,
                page: searchPage,
              },
              timeout: 12000,
              validateStatus: () => true,
              headers: {
                'User-Agent': 'CogniCare-Reels/1.0 (Family app)',
                Accept: 'application/json',
              },
            });
            if (typeof data === 'object' && Array.isArray(data)) {
              items = data.filter((x) => (x.lengthSeconds ?? 999) <= 90);
              break;
            }
          } catch {
            continue;
          }
        }
      }

      for (const v of items) {
        if (v.type !== 'video' || !v.videoId) continue;
        if ((v.lengthSeconds ?? 0) > 120) continue;
        const videoId = v.videoId;
        if (BLOCKED_YOUTUBE_IDS.includes(videoId)) {
          skipped++;
          continue;
        }
        const title = v.title || '';
        const description = v.description || '';
        const score = this.keywordRelevanceScore(title, description);
        const minScore = 0.18;
        if (score < minScore) {
          skipped++;
          continue;
        }

        const existing = await this.reelModel
          .findOne({ source: 'youtube', sourceId: videoId })
          .exec();
        if (existing) {
          skipped++;
          continue;
        }

        const thumb =
          v.videoThumbnails?.find((t) => t.quality === 'medium')?.url ||
          v.videoThumbnails?.[0]?.url ||
          '';
        const videoUrl = `https://www.youtube.com/shorts/${videoId}`;
        const publishedAt = v.published
          ? new Date(v.published * 1000)
          : new Date();

        await this.reelModel.create({
          sourceId: videoId,
          source: 'youtube',
          title,
          description: (description || '').slice(0, 500),
          videoUrl,
          thumbnailUrl:
            thumb || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          publishedAt,
          relevanceScore: score,
          language: 'fr',
        });
        added++;
      }
    }

    // Sources alternatives : Dailymotion (API gratuite) + liste de secours YouTube
    try {
      const fromDm = await this.refreshFromDailymotion();
      added += fromDm;
    } catch (e) {
      this.logger.warn(`Reels Dailymotion failed: ${e}`);
    }
    try {
      const fromSeed = await this.refreshFromSeedList();
      added += fromSeed;
    } catch (e) {
      this.logger.warn(`Reels seed list failed: ${e}`);
    }
    /** TikTok : une URL par ligne ou séparées par des virgules (REELS_TIKTOK_URLS). Pas de scrape du moteur TikTok — oEmbed officiel sur des liens que vous choisissez. */
    try {
      const fromTt = await this.refreshFromTiktok();
      added += fromTt;
    } catch (e) {
      this.logger.warn(`Reels TikTok failed: ${e}`);
    }

    this.logger.log(
      `Reels refresh: added=${added}, skipped=${skipped}, invidious_sort=${sortBy}, page=${searchPage}`,
    );
    return { added, skipped };
  }

  /**
   * Tâche quotidienne : enrichit le catalogue avec de nouvelles vidéos (sans doublons).
   * Désactiver : REELS_DAILY_REFRESH_ENABLED=false
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async dailyReelsRefresh(): Promise<void> {
    const enabled =
      this.config.get<string>('REELS_DAILY_REFRESH_ENABLED') !== 'false';
    if (!enabled) {
      return;
    }
    try {
      const r = await this.refreshFromYoutube();
      this.logger.log(
        `[CRON] Daily reels refresh OK: +${r.added} (skipped ${r.skipped})`,
      );
    } catch (e) {
      this.logger.error(`[CRON] Daily reels refresh failed: ${e}`);
    }
  }

  /** Récupère des vidéos depuis l’API Dailymotion (gratuite, sans clé). */
  private async refreshFromDailymotion(): Promise<number> {
    const base = 'https://api.dailymotion.com';
    const queries = [
      'Alzheimer',
      'dementia cognitive',
      'troubles cognitifs',
      'mémoire démence',
      'mild cognitive impairment',
    ];
    let added = 0;
    for (const q of queries) {
      try {
        const url = `${base}/videos?search=${encodeURIComponent(q)}&limit=12&sort=recent&fields=id,title,description,thumbnail_240_url,created_time,duration`;
        const { data } = await axios.get<{ list?: DailymotionVideo[] }>(url, {
          timeout: 15000,
        });
        const list = data?.list ?? [];
        for (const v of list) {
          if (!v?.id || !v.title) continue;
          const title = String(v.title);
          const desc = String(v.description ?? '');
          const score = this.keywordRelevanceScore(title, desc);
          if (score < 0.18) continue;
          const existing = await this.reelModel
            .findOne({ source: 'dailymotion', sourceId: v.id })
            .exec();
          if (existing) continue;
          const thumbnail = v.thumbnail_240_url ?? '';
          const videoUrl = `https://www.dailymotion.com/video/${v.id}`;
          await this.reelModel.create({
            sourceId: v.id,
            source: 'dailymotion',
            title: title.slice(0, 200),
            description: desc.slice(0, 500),
            videoUrl,
            thumbnailUrl: thumbnail,
            publishedAt: v.created_time
              ? new Date(v.created_time * 1000)
              : new Date(),
            relevanceScore: score,
            language: 'fr',
          });
          added += 1;
        }
      } catch (e) {
        this.logger.warn(`Dailymotion search "${q}" failed: ${e}`);
      }
    }
    return added;
  }

  /** Remplit avec une liste de secours d’IDs YouTube (oEmbed). */
  private async refreshFromSeedList(): Promise<number> {
    let added = 0;
    for (const videoId of SEED_YOUTUBE_IDS) {
      try {
        const existing = await this.reelModel
          .findOne({ source: 'youtube', sourceId: videoId })
          .exec();
        if (existing) continue;
        const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const { data } = await axios.get<{
          title?: string;
          thumbnail_url?: string;
        }>(url, { timeout: 8000 });
        const title = data?.title ?? `Vidéo ${videoId}`;
        const thumbnailUrl =
          data?.thumbnail_url ??
          `https://img.youtube.com/vi/${videoId}/default.jpg`;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const score = this.keywordRelevanceScore(title, '');
        await this.reelModel.create({
          sourceId: videoId,
          source: 'youtube',
          title: title.slice(0, 200),
          description: '',
          videoUrl,
          thumbnailUrl: thumbnailUrl.replace('hqdefault', 'mqdefault'),
          publishedAt: new Date(),
          relevanceScore: score > 0 ? score : 0.25,
        });
        added += 1;
      } catch {
        // skip invalid or unavailable
      }
    }
    return added;
  }

  /** URLs TikTok depuis REELS_TIKTOK_URLS (newline ou virgule). */
  private parseTiktokUrlsFromEnv(): string[] {
    const raw = this.config.get<string>('REELS_TIKTOK_URLS') ?? '';
    const parts = raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(parts)];
  }

  private extractTiktokVideoId(url: string): string | null {
    const m = url.match(/\/video\/(\d+)/);
    return m?.[1] ?? null;
  }

  /**
   * Ajoute des reels TikTok via l’API oEmbed (métadonnées + miniature), sans doublon (source + sourceId).
   */
  private async refreshFromTiktok(): Promise<number> {
    const urls = this.parseTiktokUrlsFromEnv();
    if (urls.length === 0) return 0;

    let added = 0;
    for (const pageUrl of urls) {
      const videoId = this.extractTiktokVideoId(pageUrl);
      if (!videoId) {
        this.logger.warn(
          `Reels TikTok: URL ignorée (pas d’id /video/…) — ${pageUrl.slice(0, 96)}`,
        );
        continue;
      }
      const existing = await this.reelModel
        .findOne({ source: 'tiktok', sourceId: videoId })
        .exec();
      if (existing) continue;

      try {
        const oembed = `https://www.tiktok.com/oembed?url=${encodeURIComponent(pageUrl)}`;
        const { data } = await axios.get<TikTokOEmbedResponse>(oembed, {
          timeout: 15000,
          headers: {
            'User-Agent': 'CogniCare-Reels/1.0 (Family app)',
            Accept: 'application/json',
          },
          validateStatus: (s) => s === 200,
        });
        const title = (data?.title ?? 'TikTok').slice(0, 200);
        const authorName = data?.author_name?.slice(0, 120);
        const thumbnailUrl = (data?.thumbnail_url ?? '').trim();
        const canonicalUrl = pageUrl.split('?')[0];
        await this.reelModel.create({
          source: 'tiktok',
          sourceId: videoId,
          title,
          description: '',
          videoUrl: canonicalUrl,
          thumbnailUrl: thumbnailUrl || '',
          publishedAt: new Date(),
          relevanceScore: 0.92,
          language: 'fr',
          authorName,
        });
        added += 1;
      } catch (e) {
        this.logger.warn(`Reels TikTok oEmbed vidéo ${videoId} failed: ${e}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (added > 0) {
      this.logger.log(
        `Reels TikTok: +${added} (sur ${urls.length} URL(s) configurée(s))`,
      );
    }
    return added;
  }

  /**
   * Like a reel (increment likesCount if not already liked by user)
   */
  async likeReel(
    reelId: string,
    userId: string,
  ): Promise<{ success: boolean; likesCount: number }> {
    const reelObjectId = new Types.ObjectId(reelId);
    const userObjectId = new Types.ObjectId(userId);

    // Check if already liked
    const existing = await this.engagementModel.findOne({
      reelId: reelObjectId,
      userId: userObjectId,
      type: 'like',
    });

    if (existing) {
      // Already liked, return current count
      const reel = await this.reelModel.findById(reelObjectId).lean().exec();
      return {
        success: false,
        likesCount: reel?.likesCount ?? 0,
      };
    }

    // Create engagement record and increment counter
    try {
      await this.engagementModel.create({
        reelId: reelObjectId,
        userId: userObjectId,
        type: 'like',
      });
    } catch (error) {
      // Handle duplicate key from concurrent requests gracefully.
      if ((error as { code?: number })?.code === 11000) {
        const reel = await this.reelModel.findById(reelObjectId).lean().exec();
        return {
          success: false,
          likesCount: reel?.likesCount ?? 0,
        };
      }
      throw new ConflictException('Unable to like reel');
    }

    const updated = await this.reelModel
      .findByIdAndUpdate(
        reelObjectId,
        { $inc: { likesCount: 1 } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Reel not found');
    }

    return {
      success: true,
      likesCount: updated?.likesCount ?? 0,
    };
  }

  /**
   * Unlike a reel (decrement likesCount if liked by user)
   */
  async unlikeReel(
    reelId: string,
    userId: string,
  ): Promise<{ success: boolean; likesCount: number }> {
    const reelObjectId = new Types.ObjectId(reelId);
    const userObjectId = new Types.ObjectId(userId);

    // Check if already liked
    const existing = await this.engagementModel.findOneAndDelete({
      reelId: reelObjectId,
      userId: userObjectId,
      type: 'like',
    });

    if (!existing) {
      // Not liked, return current count
      const reel = await this.reelModel.findById(reelObjectId).lean().exec();
      return {
        success: false,
        likesCount: reel?.likesCount ?? 0,
      };
    }

    // Decrement counter
    const updated = await this.reelModel
      .findByIdAndUpdate(
        reelObjectId,
        { $inc: { likesCount: -1 }, $max: { likesCount: 0 } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Reel not found');
    }

    return {
      success: true,
      likesCount: Math.max(0, updated?.likesCount ?? 0),
    };
  }

  /**
   * Save a reel (increment savesCount if not already saved by user)
   */
  async saveReel(
    reelId: string,
    userId: string,
  ): Promise<{ success: boolean; savesCount: number }> {
    const reelObjectId = new Types.ObjectId(reelId);
    const userObjectId = new Types.ObjectId(userId);

    // Check if already saved
    const existing = await this.engagementModel.findOne({
      reelId: reelObjectId,
      userId: userObjectId,
      type: 'save',
    });

    if (existing) {
      // Already saved, return current count
      const reel = await this.reelModel.findById(reelObjectId).lean().exec();
      return {
        success: false,
        savesCount: reel?.savesCount ?? 0,
      };
    }

    // Create engagement record and increment counter
    try {
      await this.engagementModel.create({
        reelId: reelObjectId,
        userId: userObjectId,
        type: 'save',
      });
    } catch (error) {
      // Handle duplicate key from concurrent requests gracefully.
      if ((error as { code?: number })?.code === 11000) {
        const reel = await this.reelModel.findById(reelObjectId).lean().exec();
        return {
          success: false,
          savesCount: reel?.savesCount ?? 0,
        };
      }
      throw new ConflictException('Unable to save reel');
    }

    const updated = await this.reelModel
      .findByIdAndUpdate(
        reelObjectId,
        { $inc: { savesCount: 1 } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Reel not found');
    }

    return {
      success: true,
      savesCount: updated?.savesCount ?? 0,
    };
  }

  /**
   * Unsave a reel (decrement savesCount if saved by user)
   */
  async unsaveReel(
    reelId: string,
    userId: string,
  ): Promise<{ success: boolean; savesCount: number }> {
    const reelObjectId = new Types.ObjectId(reelId);
    const userObjectId = new Types.ObjectId(userId);

    // Check if already saved
    const existing = await this.engagementModel.findOneAndDelete({
      reelId: reelObjectId,
      userId: userObjectId,
      type: 'save',
    });

    if (!existing) {
      // Not saved, return current count
      const reel = await this.reelModel.findById(reelObjectId).lean().exec();
      return {
        success: false,
        savesCount: reel?.savesCount ?? 0,
      };
    }

    // Decrement counter
    const updated = await this.reelModel
      .findByIdAndUpdate(
        reelObjectId,
        { $inc: { savesCount: -1 }, $max: { savesCount: 0 } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Reel not found');
    }

    return {
      success: true,
      savesCount: Math.max(0, updated?.savesCount ?? 0),
    };
  }

  /**
   * Track a share
   */
  async trackShare(
    reelId: string,
    userId: string,
  ): Promise<{ success: boolean; sharesCount: number }> {
    const reelObjectId = new Types.ObjectId(reelId);
    void userId;

    const updated = await this.reelModel
      .findByIdAndUpdate(
        reelObjectId,
        { $inc: { sharesCount: 1 } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Reel not found');
    }

    return {
      success: true,
      sharesCount: updated?.sharesCount ?? 0,
    };
  }

  /**
   * Track a comment interaction on a reel
   */
  async trackComment(
    reelId: string,
    userId: string,
  ): Promise<{ success: boolean; commentsCount: number }> {
    const reelObjectId = new Types.ObjectId(reelId);
    void userId;

    const updated = await this.reelModel
      .findByIdAndUpdate(
        reelObjectId,
        { $inc: { commentsCount: 1 } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Reel not found');
    }

    return {
      success: true,
      commentsCount: updated?.commentsCount ?? 0,
    };
  }

  /**
   * Check if user has already liked a reel
   */
  async hasUserLiked(reelId: string, userId: string): Promise<boolean> {
    const engagement = await this.engagementModel.findOne({
      reelId: new Types.ObjectId(reelId),
      userId: new Types.ObjectId(userId),
      type: 'like',
    });
    return !!engagement;
  }

  /**
   * Check if user has already saved a reel
   */
  async hasUserSaved(reelId: string, userId: string): Promise<boolean> {
    const engagement = await this.engagementModel.findOne({
      reelId: new Types.ObjectId(reelId),
      userId: new Types.ObjectId(userId),
      type: 'save',
    });
    return !!engagement;
  }
}
