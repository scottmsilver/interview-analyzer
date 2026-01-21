#!/usr/bin/env npx tsx
/**
 * Admin management script for Interview Analyzer
 *
 * Prerequisites:
 *   1. Install Firebase CLI: npm install -g firebase-tools
 *   2. Login to Firebase: firebase login
 *   3. Set up Application Default Credentials: gcloud auth application-default login
 *      OR set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file
 *
 * Usage:
 *   npx tsx scripts/manage-admins.ts add <email>     - Add an admin
 *   npx tsx scripts/manage-admins.ts remove <email>  - Remove an admin
 *   npx tsx scripts/manage-admins.ts list            - List all admins
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = 'interview-analyzer-prod';
const ADMINS_DOC_PATH = 'config/admins';

// Initialize Firebase Admin
function initFirebase() {
  try {
    // Try Application Default Credentials first (works with gcloud auth or GOOGLE_APPLICATION_CREDENTIALS)
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
    console.error('  Option 3: firebase login (and ensure you have project access)');
    process.exit(1);
  }
}

async function addAdmin(email: string) {
  const db = getFirestore();
  const normalizedEmail = email.toLowerCase().trim();

  if (!normalizedEmail.includes('@')) {
    console.error('✗ Invalid email address:', email);
    process.exit(1);
  }

  const docRef = db.doc(ADMINS_DOC_PATH);
  const doc = await docRef.get();

  if (!doc.exists) {
    // First admin - create the document
    await docRef.set({
      emails: [normalizedEmail],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    console.log('✓ Created admins config with first admin:', normalizedEmail);
  } else {
    const data = doc.data();
    const existingEmails: string[] = data?.emails || [];

    if (existingEmails.includes(normalizedEmail)) {
      console.log('→ Email already an admin:', normalizedEmail);
      return;
    }

    await docRef.update({
      emails: FieldValue.arrayUnion(normalizedEmail),
      updatedAt: FieldValue.serverTimestamp()
    });
    console.log('✓ Added admin:', normalizedEmail);
  }
}

async function removeAdmin(email: string) {
  const db = getFirestore();
  const normalizedEmail = email.toLowerCase().trim();

  const docRef = db.doc(ADMINS_DOC_PATH);
  const doc = await docRef.get();

  if (!doc.exists) {
    console.error('✗ No admins config exists yet');
    process.exit(1);
  }

  const data = doc.data();
  const existingEmails: string[] = data?.emails || [];

  if (!existingEmails.includes(normalizedEmail)) {
    console.log('→ Email is not an admin:', normalizedEmail);
    return;
  }

  if (existingEmails.length === 1) {
    console.error('✗ Cannot remove the last admin');
    process.exit(1);
  }

  await docRef.update({
    emails: FieldValue.arrayRemove(normalizedEmail),
    updatedAt: FieldValue.serverTimestamp()
  });
  console.log('✓ Removed admin:', normalizedEmail);
}

async function listAdmins() {
  const db = getFirestore();
  const docRef = db.doc(ADMINS_DOC_PATH);
  const doc = await docRef.get();

  if (!doc.exists) {
    console.log('No admins configured yet.');
    console.log('\nTo add the first admin:');
    console.log('  npx tsx scripts/manage-admins.ts add your@email.com');
    return;
  }

  const data = doc.data();
  const emails: string[] = data?.emails || [];

  console.log('\nCurrent admins:');
  emails.forEach((email, i) => {
    console.log(`  ${i + 1}. ${email}`);
  });
  console.log(`\nTotal: ${emails.length} admin(s)`);
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const email = args[1];

  if (!command || !['add', 'remove', 'list'].includes(command)) {
    console.log('Interview Analyzer - Admin Management\n');
    console.log('Usage:');
    console.log('  npx tsx scripts/manage-admins.ts add <email>     Add an admin');
    console.log('  npx tsx scripts/manage-admins.ts remove <email>  Remove an admin');
    console.log('  npx tsx scripts/manage-admins.ts list            List all admins');
    console.log('\nPrerequisites:');
    console.log('  Run: gcloud auth application-default login');
    process.exit(0);
  }

  initFirebase();

  switch (command) {
    case 'add':
      if (!email) {
        console.error('✗ Email required for add command');
        process.exit(1);
      }
      await addAdmin(email);
      break;
    case 'remove':
      if (!email) {
        console.error('✗ Email required for remove command');
        process.exit(1);
      }
      await removeAdmin(email);
      break;
    case 'list':
      await listAdmins();
      break;
  }
}

main().catch(console.error);
