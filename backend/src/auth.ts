/**
 * Firebase Authentication and user approval middleware.
 */

import type { NextFunction, Request, Response } from 'express';
import { getAdminAuth, getDb, isFirebaseConfigured } from './firebase-admin.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export interface AuthDeps {
  verifyIdToken: (token: string) => Promise<{ uid: string; email?: string }>;
  isConfigured: () => boolean;
  getFirestore: () => ReturnType<typeof getDb>;
}

const defaultAuthDeps: AuthDeps = {
  verifyIdToken: (token: string) => getAdminAuth().verifyIdToken(token),
  isConfigured: () => isFirebaseConfigured(),
  getFirestore: () => getDb(),
};

const APPROVAL_CACHE_TTL_MS = 60_000;
const MAX_APPROVAL_CACHE_ENTRIES = 1000;
const approvalCache = new Map<string, number>();

/**
 * Clear positive approval cache entries (for testing).
 */
export function clearApprovalCache(): void {
  approvalCache.clear();
}

/**
 * Extract a Bearer token from the Authorization header.
 */
export function extractBearerToken(req: Pick<Request, 'headers'>): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function getCachedApproval(uid: string): boolean {
  const expiresAt = approvalCache.get(uid);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    approvalCache.delete(uid);
    return false;
  }
  return true;
}

function setCachedApproval(uid: string): void {
  if (approvalCache.size >= MAX_APPROVAL_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [key, expiresAt] of approvalCache.entries()) {
      if (expiresAt <= now) {
        approvalCache.delete(key);
      }
    }
    if (approvalCache.size >= MAX_APPROVAL_CACHE_ENTRIES) {
      approvalCache.clear();
    }
  }
  approvalCache.set(uid, Date.now() + APPROVAL_CACHE_TTL_MS);
}

/**
 * Check whether an authenticated user is approved in Firestore.
 * Fails closed on errors or missing configuration.
 */
export async function isUserApproved(
  uid: string,
  email?: string,
  deps: Pick<AuthDeps, 'isConfigured' | 'getFirestore'> = defaultAuthDeps
): Promise<boolean> {
  if (getCachedApproval(uid)) {
    return true;
  }

  if (!deps.isConfigured()) {
    return false;
  }

  try {
    const db = deps.getFirestore();
    const normalizedEmail = email?.trim().toLowerCase();

    const [userDoc, adminDoc, adminsConfigDoc] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('admins').doc(uid).get(),
      normalizedEmail ? db.collection('config').doc('admins').get() : Promise.resolve(null),
    ]);

    if (userDoc.exists && userDoc.data()?.approved === true) {
      setCachedApproval(uid);
      return true;
    }

    if (adminDoc.exists) {
      setCachedApproval(uid);
      return true;
    }

    if (normalizedEmail && adminsConfigDoc?.exists) {
      const emails = adminsConfigDoc.data()?.emails;
      if (
        Array.isArray(emails) &&
        emails.some(
          (entry): entry is string =>
            typeof entry === 'string' && entry.trim().toLowerCase() === normalizedEmail
        )
      ) {
        setCachedApproval(uid);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('[Auth] Failed to check user approval in Firestore:', error);
    return false;
  }
}

/**
 * Create a `requireApprovedUser` Express middleware (parameterized for testing).
 */
export function createRequireApprovedUser(deps: AuthDeps = defaultAuthDeps) {
  return async function requireApprovedUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    let decoded: { uid: string; email?: string };
    try {
      decoded = await deps.verifyIdToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const approved = await isUserApproved(decoded.uid, decoded.email, deps);
    if (!approved) {
      res.status(403).json({ error: 'Account pending approval' });
      return;
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
    };
    next();
  };
}

/**
 * Express middleware requiring a valid Firebase ID token belonging to an approved user.
 */
export const requireApprovedUser = createRequireApprovedUser();

/**
 * Optionally verify a Firebase ID token from the Authorization header.
 * Returns `{ uid, email }` if valid, or `null` if missing/invalid.
 */
export async function optionalVerifiedUser(
  req: Pick<Request, 'headers'>,
  deps: Pick<AuthDeps, 'verifyIdToken' | 'isConfigured'> = defaultAuthDeps
): Promise<AuthenticatedUser | null> {
  const token = extractBearerToken(req);
  if (!token || !deps.isConfigured()) {
    return null;
  }

  try {
    const decoded = await deps.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}
