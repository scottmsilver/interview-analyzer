/**
 * Firebase Admin SDK initialization for backend services
 * Used for Firestore access and Firebase ID token verification
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';

let app: App;
let firestore: Firestore;
let adminAuth: Auth;

const DEFAULT_PROJECT_ID = 'interview-analyzer-prod';

function getProjectId(): string {
  return process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID;
}

function getAdcPath(): string {
  return path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

/**
 * Initialize Firebase Admin SDK
 *
 * Supports:
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON env var (inline JSON string)
 * 2. GOOGLE_APPLICATION_CREDENTIALS env var (path to service account JSON)
 * 3. Application Default Credentials (auto on GCP/Cloud Run or local gcloud ADC)
 */
function initializeFirebaseAdmin(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = getProjectId();

  // Option 1: Inline service account JSON from env var
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      console.log('[Firebase Admin] Initializing with service account JSON from env');
      return initializeApp({
        credential: cert(serviceAccount),
        projectId
      });
    } catch (error) {
      console.error('[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error);
      throw error;
    }
  }

  // Option 2: GOOGLE_APPLICATION_CREDENTIALS points to service account file
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('[Firebase Admin] Initializing with GOOGLE_APPLICATION_CREDENTIALS');
    return initializeApp({ projectId });
  }

  // Option 3: Application Default Credentials (works on GCP/Cloud Run or gcloud auth ADC)
  console.log('[Firebase Admin] Initializing with Application Default Credentials');
  return initializeApp({ projectId });
}

function getFirebaseApp(): App {
  if (!app) {
    app = initializeFirebaseAdmin();
  }
  return app;
}

/**
 * Get the Firestore instance (lazy initialization)
 */
export function getDb(): Firestore {
  if (!firestore) {
    firestore = getFirestore(getFirebaseApp());
  }
  return firestore;
}

/**
 * Get the Firebase Admin Auth instance (lazy initialization)
 */
export function getAdminAuth(): Auth {
  if (!adminAuth) {
    adminAuth = getAuth(getFirebaseApp());
  }
  return adminAuth;
}

/**
 * Check if Firebase Admin is properly configured
 */
export function isFirebaseConfigured(): boolean {
  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_USE_ADC === 'true'
  ) {
    return true;
  }

  try {
    return fs.existsSync(getAdcPath());
  } catch {
    return false;
  }
}

// Re-export Timestamp for use in other modules
export { Timestamp };
