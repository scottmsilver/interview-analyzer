#!/usr/bin/env npx tsx
/**
 * Seed initial interview types into Firestore
 *
 * Prerequisites:
 *   1. Install Firebase CLI: npm install -g firebase-tools
 *   2. Login to Firebase: firebase login
 *   3. Set up Application Default Credentials: gcloud auth application-default login
 *      OR set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file
 *
 * Usage:
 *   npx tsx scripts/seed-interview-types.ts
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'interview-analyzer-prod';

// Initial interview types with their evaluation criteria
const INTERVIEW_TYPES = [
  {
    id: 'google-apm',
    name: 'Google APM',
    criteria: `EVALUATION CRITERIA FOR GOOGLE APM:
- Product Sense: User focus, creativity, prioritization, strategic alignment with company goals
- Analytical Thinking: Metrics definition, A/B testing, data-driven decisions, SQL/analytics
- Communication: Structure, pacing, clarity, checking in with interviewer every 45-60 seconds
- Technical Depth: Understanding of AI/ML, system design, feasibility, working with engineers
- Strategic Thinking: Business impact, competitive analysis, ecosystem effects
- "Googleyness": User-first thinking, collaboration, handling ambiguity`
  },
  {
    id: 'meta-pm',
    name: 'Meta PM',
    criteria: `EVALUATION CRITERIA FOR META PM:
- Product Sense: User empathy, feature prioritization, Meta's mission alignment
- Execution: Roadmapping, tradeoffs, working with cross-functional teams
- Analytics: Metrics trees, debugging metrics drops, experimentation
- Leadership: Influence without authority, conflict resolution
- Strategy: Vision, competitive positioning, business model understanding`
  },
  {
    id: 'amazon-pm',
    name: 'Amazon PM',
    criteria: `EVALUATION CRITERIA FOR AMAZON PM:
- Customer Obsession: Starting with the customer and working backwards
- Leadership Principles: Ownership, Bias for Action, Think Big, Dive Deep, etc.
- Working Backwards: PRD/Press Release approach
- Metrics: Input vs Output metrics, mechanisms for driving results
- Technical Depth: SQL, APIs, system design basics`
  },
  {
    id: 'generic',
    name: 'Generic PM',
    criteria: `EVALUATION CRITERIA:
- Product Thinking: User focus, problem definition, solution creativity
- Analytical Skills: Metrics, data analysis, hypothesis testing
- Communication: Structure, clarity, conciseness
- Strategic Thinking: Business impact, prioritization
- Execution: Practical considerations, feasibility`
  }
];

// Initialize Firebase Admin
function initFirebase() {
  try {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID
    });
    console.log('✓ Connected to Firebase project:', PROJECT_ID);
  } catch (error) {
    console.error('✗ Failed to initialize Firebase Admin SDK');
    console.error('\nMake sure you have authenticated:');
    console.error('  Option 1: gcloud auth application-default login');
    console.error('  Option 2: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json');
    process.exit(1);
  }
}

async function seedInterviewTypes() {
  const db = getFirestore();
  const now = new Date().toISOString();

  console.log('\nSeeding interview types...\n');

  for (const type of INTERVIEW_TYPES) {
    const docRef = db.collection('interviewTypes').doc(type.id);
    const existing = await docRef.get();

    if (existing.exists) {
      console.log(`  ⏭  ${type.name} (${type.id}) - already exists, skipping`);
      continue;
    }

    await docRef.set({
      name: type.name,
      criteria: type.criteria,
      createdAt: now,
      updatedAt: now,
      isBuiltIn: true
    });

    console.log(`  ✓  ${type.name} (${type.id}) - created`);
  }

  console.log('\n✓ Done seeding interview types');
}

async function main() {
  initFirebase();
  await seedInterviewTypes();
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
