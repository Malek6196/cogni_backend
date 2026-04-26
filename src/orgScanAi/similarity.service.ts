import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FraudAnalysis,
  FraudAnalysisDocument,
} from './schemas/fraud-analysis.schema';
const EMBEDDING_DIMENSIONS = 256;

@Injectable()
export class SimilarityService {
  private readonly logger = new Logger(SimilarityService.name);

  constructor(
    @InjectModel(FraudAnalysis.name)
    private fraudAnalysisModel: Model<FraudAnalysisDocument>,
  ) {
    this.logger.log(
      'Similarity service initialized with local hashed-token embeddings',
    );
  }

  /**
   * Check if the similarity service is ready
   */
  isReady(): boolean {
    return true;
  }

  /**
   * Generate embedding vector from text
   * @param text - Document text to embed
   * @returns Embedding vector as number array
   */
  generateEmbedding(text: string): Promise<number[]> {
    if (!this.isReady()) {
      this.logger.warn(
        'Embedding model not initialized, returning empty embedding',
      );
      return Promise.resolve([]);
    }

    try {
      const embedding = this.buildHashedEmbedding(text);

      this.logger.debug(
        `Generated embedding with ${embedding.length} dimensions`,
      );
      return Promise.resolve(embedding);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to generate embedding: ${message}`);
      return Promise.resolve([]);
    }
  }

  /**
   * Build a deterministic normalized embedding without external ML runtimes.
   * This preserves similarity scoring while avoiding heavyweight vulnerable deps.
   */
  private buildHashedEmbedding(text: string): number[] {
    const normalized = text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, ' ')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
    if (!normalized) {
      return [];
    }

    const tokens = normalized
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    if (tokens.length === 0) {
      return [];
    }

    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    const totalTokens = tokens.length;

    for (let index = 0; index < totalTokens; index += 1) {
      const token = tokens[index];
      const tokenWeight = token.length > 6 ? 1.35 : token.length > 3 ? 1.15 : 1;
      const currentBucket = this.hashToken(token) % EMBEDDING_DIMENSIONS;
      vector[currentBucket] += tokenWeight;

      if (index < totalTokens - 1) {
        const bigramBucket =
          this.hashToken(`${token}_${tokens[index + 1]}`) %
          EMBEDDING_DIMENSIONS;
        vector[bigramBucket] += tokenWeight * 0.45;
      }
    }

    let norm = 0;
    for (const value of vector) {
      norm += value * value;
    }
    norm = Math.sqrt(norm);
    if (norm === 0) {
      return [];
    }
    return vector.map((value) => Number((value / norm).toFixed(8)));
  }

  private hashToken(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }

  /**
   * Compute cosine similarity between two vectors
   * @param vecA - First vector
   * @param vecB - Second vector
   * @returns Similarity score between 0 and 1
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length === 0 || vecB.length === 0) {
      return 0;
    }

    if (vecA.length !== vecB.length) {
      this.logger.warn('Vector dimension mismatch');
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

    if (magnitude === 0) {
      return 0;
    }

    // Cosine similarity normalized to 0-1 range
    const similarity = dotProduct / magnitude;
    return Math.max(0, Math.min(1, (similarity + 1) / 2));
  }

  /**
   * Find maximum similarity against previous submissions
   * @param embedding - New document embedding
   * @param excludeId - Optional ID to exclude from comparison
   * @returns Object with similarity score and risk level
   */
  async findMaxSimilarity(
    embedding: number[],
    excludeId?: string,
  ): Promise<{
    similarityScore: number;
    similarityRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  }> {
    if (embedding.length === 0) {
      return { similarityScore: 0, similarityRisk: 'LOW' };
    }

    try {
      // Retrieve previous submissions with embeddings
      const query: Record<string, unknown> = {
        embedding: { $exists: true, $ne: [] },
      };

      if (excludeId) {
        query._id = { $ne: excludeId };
      }

      const previousSubmissions = await this.fraudAnalysisModel
        .find(query)
        .select('embedding isRejected')
        .lean()
        .exec();

      if (previousSubmissions.length === 0) {
        this.logger.debug('No previous submissions found for comparison');
        return { similarityScore: 0, similarityRisk: 'LOW' };
      }

      let maxSimilarity = 0;
      let foundSimilarRejected = false;

      for (const submission of previousSubmissions) {
        if (!submission.embedding || submission.embedding.length === 0) {
          continue;
        }

        const similarity = this.cosineSimilarity(
          embedding,
          submission.embedding,
        );

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;

          // Flag if similar to a rejected submission
          if (submission.isRejected && similarity > 0.85) {
            foundSimilarRejected = true;
          }
        }
      }

      // Determine risk level
      let similarityRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

      if (maxSimilarity > 0.85) {
        similarityRisk = 'HIGH';
      } else if (maxSimilarity > 0.7) {
        similarityRisk = 'MEDIUM';
      }

      this.logger.log(
        `Max similarity: ${maxSimilarity.toFixed(3)}, Risk: ${similarityRisk}${foundSimilarRejected ? ' (similar to rejected)' : ''}`,
      );

      return {
        similarityScore: maxSimilarity,
        similarityRisk,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to compute similarity: ${message}`);
      return { similarityScore: 0, similarityRisk: 'LOW' };
    }
  }

  /**
   * Get similarity risk level from score
   */
  getSimilarityRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (score > 0.85) return 'HIGH';
    if (score > 0.7) return 'MEDIUM';
    return 'LOW';
  }
}
