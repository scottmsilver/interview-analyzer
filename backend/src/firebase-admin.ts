/**
 * Firebase Admin SDK initialization for backend services
 * Used for writing to Firestore (criteria cache)
 */

import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';

let app: App;
let firestore: Firestore;

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'interview-analyzer-prod';

/**
 * Initialize Firebase Admin SDK
 *
 * Supports:
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON env var (inline JSON string - for Fly.io secrets)
 * 2. GOOGLE_APPLICATION_CREDENTIALS env var (path to service account JSON)
 * 3. Application Default Credentials (auto on GCP/Cloud Run)
 */
function initializeFirebaseAdmin(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  // Option 1: Inline service account JSON from env var (best for Fly.io)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      console.log('[Firebase Admin] Initializing with service account JSON from env');
      return initializeApp({
        credential: cert(serviceAccount),
        projectId: PROJECT_ID
      });
    } catch (error) {
      console.error('[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error);
      throw error;
    }
  }

  // Option 2: GOOGLE_APPLICATION_CREDENTIALS points to service account file
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('[Firebase Admin] Initializing with GOOGLE_APPLICATION_CREDENTIALS');
    return initializeApp({ projectId: PROJECT_ID });
  }

  // Option 3: Application Default Credentials (works on GCP/Cloud Run)
  console.log('[Firebase Admin] Initializing with Application Default Credentials');
  return initializeApp({ projectId: PROJECT_ID });
}

/**
 * Get the Firestore instance (lazy initialization)
 */
export function getDb(): Firestore {
  if (!firestore) {
    if (!app) {
      app = initializeFirebaseAdmin();
    }
    firestore = getFirestore(app);
  }
  return firestore;
}

/**
 * Check if Firebase Admin is properly configured
 */
export function isFirebaseConfigured(): boolean {
  return !!(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

// Re-export Timestamp for use in other modules
export { Timestamp };
