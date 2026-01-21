import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth'
import { db, auth } from './firebase'
import { type AnalysisData } from './types'

// Re-export User type for convenience
export type { User }

// =============================================================================
// Auth API
// =============================================================================

const googleProvider = new GoogleAuthProvider()

export function subscribeToAuthState(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback)
}

export async function signInWithGoogle(): Promise<User> {
  googleProvider.setCustomParameters({ prompt: 'select_account' })
  const result = await signInWithPopup(auth, googleProvider)
  return result.user
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
}

export function getCurrentUser(): User | null {
  return auth.currentUser
}

// =============================================================================
// Users API
// =============================================================================

export interface UserRecord {
  email: string
  approved: boolean
  createdAt: string
  approvedAt?: string
}

export async function getUser(userId: string): Promise<UserRecord | null> {
  const docSnap = await getDoc(doc(db, 'users', userId))
  return docSnap.exists() ? (docSnap.data() as UserRecord) : null
}

export async function createUser(userId: string, data: UserRecord): Promise<void> {
  await setDoc(doc(db, 'users', userId), data)
}

export async function approveUser(userId: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId), {
    approved: true,
    approvedAt: new Date().toISOString(),
  })
}

export function subscribeToAllUsers(callback: (users: (UserRecord & { id: string })[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'users'), (snapshot) => {
    const users: (UserRecord & { id: string })[] = []
    snapshot.forEach((doc) => {
      users.push({ id: doc.id, ...doc.data() } as UserRecord & { id: string })
    })
    callback(users)
  })
}

export function subscribeToUserApproval(
  userId: string,
  callback: (data: UserRecord | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'users', userId), (snapshot) => {
    callback(snapshot.exists() ? (snapshot.data() as UserRecord) : null)
  })
}

// =============================================================================
// Admins API
// =============================================================================

export interface AdminRecord {
  email: string
  gmailTokens?: unknown
  gmailAuthorizedAt?: string
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  // Check UID-based admin (legacy)
  const uidDocSnap = await getDoc(doc(db, 'admins', userId))
  if (uidDocSnap.exists()) return true

  // Check email-based admin (from config/admins)
  const user = auth.currentUser
  if (!user?.email) return false

  const configDocSnap = await getDoc(doc(db, 'config', 'admins'))
  if (!configDocSnap.exists()) return false

  const emails: string[] = configDocSnap.data()?.emails || []
  return emails.includes(user.email.toLowerCase())
}

export function subscribeToAdminData(
  userId: string,
  callback: (data: AdminRecord | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'admins', userId), (snapshot) => {
    callback(snapshot.exists() ? (snapshot.data() as AdminRecord) : null)
  })
}

export async function updateAdminGmail(
  userId: string,
  gmailTokens: unknown | null,
  gmailAuthorizedAt: string | null
): Promise<void> {
  await updateDoc(doc(db, 'admins', userId), {
    gmailTokens,
    gmailAuthorizedAt,
  })
}

// =============================================================================
// Analyses API
// =============================================================================

export interface CreateAnalysisData {
  userId: string
  interviewType: string
  transcriptFileName: string
  transcriptContent: string
  analysis: string
  title: string
  savedAt: string
  createdAt: string
  updatedAt: string
  shareId: string
  shareMode: 'private' | 'anyone' | 'specific'
  sharedWith: string[]
}

export async function createAnalysis(data: CreateAnalysisData): Promise<string> {
  const docRef = await addDoc(collection(db, 'analyses'), data)
  return docRef.id
}

export async function getAnalysis(analysisId: string): Promise<AnalysisData | null> {
  const docSnap = await getDoc(doc(db, 'analyses', analysisId))
  return docSnap.exists() ? (docSnap.data() as AnalysisData) : null
}

export async function updateAnalysisSharing(
  analysisId: string,
  shareMode: 'private' | 'anyone' | 'specific',
  sharedWith: string[]
): Promise<void> {
  await updateDoc(doc(db, 'analyses', analysisId), {
    shareMode,
    sharedWith,
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteAnalysis(analysisId: string): Promise<void> {
  await deleteDoc(doc(db, 'analyses', analysisId))
}

export function subscribeToUserAnalyses(
  userId: string,
  callback: (analyses: (AnalysisData & { id: string })[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'analyses'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(q, (snapshot) => {
    const analyses: (AnalysisData & { id: string })[] = []
    snapshot.forEach((doc) => {
      analyses.push({ id: doc.id, ...doc.data() } as AnalysisData & { id: string })
    })
    callback(analyses)
  })
}

export async function getAnalysisByShareId(shareId: string): Promise<AnalysisData | null> {
  const q = query(collection(db, 'analyses'), where('shareId', '==', shareId))
  const snapshot = await getDocs(q)
  if (snapshot.empty) return null
  return snapshot.docs[0].data() as AnalysisData
}

// =============================================================================
// Interview Criteria Cache API
// =============================================================================

const CACHE_TTL_DAYS = 7

export interface CachedCriteria {
  interviewType: string
  criteria: string
  lastUpdated: string  // ISO date string
  source: 'web-search' | 'manual'
}

/**
 * Get cached interview criteria if available and fresh
 */
export async function getCachedCriteria(interviewType: string): Promise<string | null> {
  try {
    const docSnap = await getDoc(doc(db, 'interviewCriteria', interviewType))
    if (!docSnap.exists()) return null

    const data = docSnap.data() as CachedCriteria
    const lastUpdated = new Date(data.lastUpdated)
    const ageMs = Date.now() - lastUpdated.getTime()
    const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000

    if (ageMs > ttlMs) {
      console.log(`[CriteriaCache] Cache for ${interviewType} is stale`)
      return null
    }

    console.log(`[CriteriaCache] Using cached criteria for ${interviewType}`)
    return data.criteria
  } catch (error) {
    console.error('[CriteriaCache] Error fetching cached criteria:', error)
    return null
  }
}

/**
 * Save criteria to cache (requires admin permissions)
 */
export async function saveCachedCriteria(
  interviewType: string,
  criteria: string,
  source: 'web-search' | 'manual' = 'web-search'
): Promise<void> {
  const cacheData: CachedCriteria = {
    interviewType,
    criteria,
    lastUpdated: new Date().toISOString(),
    source
  }

  await setDoc(doc(db, 'interviewCriteria', interviewType), cacheData)
  console.log(`[CriteriaCache] Saved cache for ${interviewType}`)
}

/**
 * Get cache info for admin display
 */
export async function getCacheInfo(interviewType: string): Promise<{ lastUpdated: Date; source: string } | null> {
  try {
    const docSnap = await getDoc(doc(db, 'interviewCriteria', interviewType))
    if (!docSnap.exists()) return null

    const data = docSnap.data() as CachedCriteria
    return {
      lastUpdated: new Date(data.lastUpdated),
      source: data.source
    }
  } catch {
    return null
  }
}
