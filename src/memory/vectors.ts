/**
 * KiroGraph Memory — Vector embedding and search
 *
 * Reuses the same embedding model and semantic engine as the code graph,
 * but operates on mem_vectors table independently.
 */

import type { KiroGraphConfig } from '../config';
import type { MemObservation, ScoredObservation } from './types';
import type { MemoryDatabase } from './database';
import { logDebug, logWarn, logError } from '../errors';

const MAX_TOKEN_CHARS = 2000;

// ── Embedder (reuses the same pipeline as code vectors) ──────────────────────

let transformers: typeof import('@huggingface/transformers') | null = null;
let pipeline: any = null;
let pipelineModel: string | null = null;

async function getTransformers() {
  if (!transformers) {
    transformers = await import('@huggingface/transformers');
  }
  return transformers;
}

async function getPipeline(modelName: string, cacheDir: string) {
  if (pipeline && pipelineModel === modelName) return pipeline;

  const tf = await getTransformers();
  pipeline = await tf.pipeline('feature-extraction', modelName, {
    cache_dir: cacheDir,
    dtype: 'fp32',
  } as any);
  pipelineModel = modelName;
  return pipeline;
}

/**
 * Build searchable text from an observation.
 * Truncated to MAX_TOKEN_CHARS.
 */
function observationToText(obs: MemObservation): string {
  const parts = [`[${obs.kind}] ${obs.content}`];
  if (obs.tags && obs.tags.length > 0) {
    parts.push(`tags: ${obs.tags.join(', ')}`);
  }
  const text = parts.join('\n');
  return text.length > MAX_TOKEN_CHARS ? text.slice(0, MAX_TOKEN_CHARS) : text;
}

/** Cosine similarity between two Float32Arrays */
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── MemoryVectorManager ──────────────────────────────────────────────────────

export class MemoryVectorManager {
  private config: KiroGraphConfig;
  private memDb: MemoryDatabase;
  private modelName: string;
  private cacheDir: string;

  constructor(config: KiroGraphConfig, memDb: MemoryDatabase) {
    this.config = config;
    this.memDb = memDb;
    this.modelName = (config as any).embeddingModel ?? 'nomic-ai/nomic-embed-text-v1.5';

    const { homedir } = require('os');
    const path = require('path');
    this.cacheDir = path.join(homedir(), '.kirograph', 'models');
  }

  /**
   * Check if embeddings are enabled in config.
   */
  isEnabled(): boolean {
    return !!(this.config as any).enableEmbeddings;
  }

  /**
   * Embed a single observation and store in mem_vectors.
   */
  async embedObservation(obs: MemObservation): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const text = observationToText(obs);
      const embedding = await this.embed(text);
      if (embedding) {
        const buffer = Buffer.from(embedding.buffer);
        this.memDb.insertVector(obs.id, buffer, this.modelName);
      }
    } catch (err) {
      logWarn(`Failed to embed observation ${obs.id}: ${err}`);
    }
  }

  /**
   * Embed multiple observations in batch.
   */
  async embedBatch(observations: MemObservation[]): Promise<number> {
    if (!this.isEnabled()) return 0;

    let embedded = 0;
    for (const obs of observations) {
      try {
        await this.embedObservation(obs);
        embedded++;
      } catch (err) {
        logWarn(`Failed to embed observation ${obs.id}: ${err}`);
      }
    }
    return embedded;
  }

  /**
   * Vector search over memory observations.
   * Falls back to empty results if embeddings are disabled or model mismatches.
   */
  async search(query: string, limit = 10): Promise<ScoredObservation[]> {
    if (!this.isEnabled()) return [];

    try {
      const queryEmbedding = await this.embed(query);
      if (!queryEmbedding) return [];

      // Get all vectors with matching model
      const allVectors = this.memDb.getAllVectors(this.modelName);
      if (allVectors.length === 0) return [];

      // Compute cosine similarity for each
      const scored: Array<{ observationId: string; score: number }> = [];
      for (const { observationId, embedding } of allVectors) {
        const vec = new Float32Array(embedding.buffer, embedding.byteOffset, embedding.byteLength / 4);
        const score = cosine(queryEmbedding, vec);
        scored.push({ observationId, score });
      }

      // Sort by score descending, take top N
      scored.sort((a, b) => b.score - a.score);
      const topN = scored.slice(0, limit);

      // Fetch full observations
      const results: ScoredObservation[] = [];
      for (const { observationId, score } of topN) {
        const obs = this.memDb.getObservation(observationId);
        if (obs) {
          results.push({ observation: obs, score, scoreSource: 'vector' });
        }
      }

      return results;
    } catch (err) {
      logError('Memory vector search failed', { error: err });
      return [];
    }
  }

  /**
   * Check if there are vectors with a mismatched model.
   */
  hasModelMismatch(): boolean {
    return this.memDb.getVectorModelMismatch(this.modelName) > 0;
  }

  /**
   * Re-embed all observations with the current model.
   */
  async reembed(batchSize = 32): Promise<number> {
    // Delete all existing vectors
    this.memDb.deleteVectors();

    // Get all observations
    const db = (this.memDb as any).db;
    const rows = db.all('SELECT * FROM mem_observations ORDER BY created_at');
    const observations: MemObservation[] = rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id ?? undefined,
      content: row.content,
      contentRaw: row.content_raw ?? undefined,
      contentHash: row.content_hash,
      kind: row.kind,
      source: row.source,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      createdAt: row.created_at,
    }));

    let embedded = 0;
    for (let i = 0; i < observations.length; i += batchSize) {
      const batch = observations.slice(i, i + batchSize);
      embedded += await this.embedBatch(batch);
    }

    return embedded;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async embed(text: string): Promise<Float32Array | null> {
    try {
      const pipe = await getPipeline(this.modelName, this.cacheDir);
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      return output.data as Float32Array;
    } catch (err) {
      logDebug(`Embedding failed: ${err}`);
      return null;
    }
  }
}
