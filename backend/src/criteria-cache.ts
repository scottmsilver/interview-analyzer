/**
 * Interview criteria cache management
 * Stores/retrieves cached interview criteria from Firestore
 */

import { getDb, isFirebaseConfigured, Timestamp } from './firebase-admin.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  AGENT_ALLOWED_TOOLS,
  AGENT_DISALLOWED_TOOLS,
  buildAgentEnv,
  detectManifestError,
  getAnthropicModel
} from './analyzer.js';

const COLLECTION_NAME = 'interviewCriteria';

export const INTERVIEW_TYPE_REGEX = /^[a-zA-Z0-9 _-]{1,80}$/;

/**
 * Validate that an interviewType is safe for Firestore doc keys and prompt interpolation.
 */
export function isValidInterviewType(interviewType: unknown): interviewType is string {
  return (
    typeof interviewType === 'string' &&
    interviewType.trim().length > 0 &&
    INTERVIEW_TYPE_REGEX.test(interviewType)
  );
}

function assertValidInterviewType(interviewType: string): void {
  if (!isValidInterviewType(interviewType)) {
    throw new Error('Invalid interviewType: must be 1-80 characters matching [a-zA-Z0-9 _-]');
  }
}

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
  assertValidInterviewType(interviewType);

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
export async function refreshCriteriaCache(
  interviewType: string,
  queryFn: typeof query = query,
  saveFn: typeof saveCachedCriteria = saveCachedCriteria
): Promise<string> {
  assertValidInterviewType(interviewType);

  const currentYear = new Date().getFullYear();
  const searchQuery = `${interviewType.replace(/-/g, ' ')} interview evaluation criteria ${currentYear} what they look for`;

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

  const model = getAnthropicModel();
  const result = queryFn({
    prompt,
    options: {
      model,
      settingSources: [],
      maxTurns: 5,
      tools: AGENT_ALLOWED_TOOLS,
      allowedTools: AGENT_ALLOWED_TOOLS,
      disallowedTools: AGENT_DISALLOWED_TOOLS,
      mcpServers: {},
      strictMcpConfig: true,
      permissionMode: 'dontAsk',
      env: buildAgentEnv(model),
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

  const manifestError = detectManifestError(criteria);
  if (manifestError) {
    throw new Error(manifestError);
  }

  // Save to Firestore
  await saveFn(interviewType, criteria, 'web-search');

  return criteria;
}
