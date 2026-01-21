/**
 * Interview criteria cache management
 * Stores/retrieves cached interview criteria from Firestore
 */

import { getDb, isFirebaseConfigured, Timestamp } from './firebase-admin.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

const COLLECTION_NAME = 'interviewCriteria';

export interface CachedCriteria {
  interviewType: string;
  criteria: string;
  lastUpdated: Timestamp;
  source: 'web-search' | 'manual';
}

/**
 * Save criteria to Firestore cache
 */
export async function saveCachedCriteria(
  interviewType: string,
  criteria: string,
  source: 'web-search' | 'manual' = 'web-search'
): Promise<void> {
  if (!isFirebaseConfigured()) {
    console.log('[CriteriaCache] Firebase not configured, skipping cache save');
    return;
  }

  const db = getDb();
  const docRef = db.collection(COLLECTION_NAME).doc(interviewType);

  const cacheData: CachedCriteria = {
    interviewType,
    criteria,
    lastUpdated: Timestamp.now(),
    source
  };

  await docRef.set(cacheData);
  console.log(`[CriteriaCache] Saved cache for ${interviewType}`);
}

/**
 * Get all cached criteria (for admin viewing)
 */
export async function getAllCachedCriteria(): Promise<(CachedCriteria & { id: string })[]> {
  if (!isFirebaseConfigured()) {
    return [];
  }

  const db = getDb();
  const snapshot = await db.collection(COLLECTION_NAME).get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data() as CachedCriteria
  }));
}

/**
 * Research interview criteria using Claude agent and save to cache
 */
export async function refreshCriteriaCache(interviewType: string): Promise<string> {
  const searchQueries: Record<string, string> = {
    'google-apm': 'Google APM Associate Product Manager interview evaluation criteria 2025 what they look for',
    'meta-pm': 'Meta Facebook Product Manager interview evaluation criteria 2025 what they look for',
    'amazon-pm': 'Amazon Product Manager interview Leadership Principles evaluation criteria 2025',
    'generic': 'Product Manager interview evaluation criteria best practices 2025'
  };

  const searchQuery = searchQueries[interviewType] || searchQueries['generic'];

  console.log(`[CriteriaCache] Researching criteria for ${interviewType}...`);

  // Use Claude agent to do web search and summarize criteria
  const prompt = `You are researching current interview evaluation criteria.

TASK:
1. Search the web for: "${searchQuery}"
2. Synthesize the key evaluation criteria, competencies, and what interviewers look for
3. Output a structured summary that can be used to evaluate interview candidates

OUTPUT FORMAT:
Provide a clear, structured summary of:
- Key competencies evaluated
- What strong candidates demonstrate
- Common evaluation dimensions
- Any company-specific frameworks or principles

Keep it concise but comprehensive (aim for 500-800 words).
Do NOT include any preamble - just output the criteria summary directly.`;

  const result = query({
    prompt,
    options: {
      settingSources: [],
      maxTurns: 5,
      permissionMode: 'bypassPermissions',
    }
  });

  let criteria = '';
  for await (const message of result) {
    if (message.type === 'result' && message.subtype === 'success' && message.result) {
      criteria = message.result;
      break;
    }
  }

  if (!criteria) {
    throw new Error('Failed to research criteria - no result from agent');
  }

  // Save to Firestore
  await saveCachedCriteria(interviewType, criteria, 'web-search');

  return criteria;
}
