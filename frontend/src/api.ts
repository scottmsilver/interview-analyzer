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

export interface GmailTokens {
  access_token?: string
  refresh_token?: string
  expiry_date?: number
}

export interface AdminRecord {
  email: string
  gmailTokens?: GmailTokens
  gmailAuthorizedAt?: string
  gmailTokenRefreshedAt?: string
  gmailTokenError?: string
  gmailTokenErrorAt?: string
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
// Invites API
// =============================================================================

export interface InviteRecord {
  email: string
  invitedBy: string
  createdAt: string
  expiresAt: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  token: string
  origin?: string
  acceptedAt?: string
  emailSent?: boolean
  emailError?: string
  emailSentAt?: string
}

export async function createInvite(email: string, invitedBy: string, origin?: string): Promise<string> {
  const token = crypto.randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const docRef = await addDoc(collection(db, 'invites'), {
    email: email.toLowerCase(),
    invitedBy,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'pending',
    token,
    origin: origin || window.location.origin, // Store origin for email link
  })
  return docRef.id
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await updateDoc(doc(db, 'invites', inviteId), {
    status: 'revoked',
  })
}

export function subscribeToInvites(
  callback: (invites: (InviteRecord & { id: string })[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, 'invites'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(
    q,
    (snapshot) => {
      const invites: (InviteRecord & { id: string })[] = []
      snapshot.forEach((doc) => {
        invites.push({ id: doc.id, ...doc.data() } as InviteRecord & { id: string })
      })
      callback(invites)
    },
    (error) => {
      console.error('Error subscribing to invites:', error)
      if (onError) onError(error)
    }
  )
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
 * Get interview criteria - first checks admin-defined types, then cached web search results
 */
export async function getCachedCriteria(interviewType: string): Promise<string | null> {
  try {
    // First check admin-defined interview types (no TTL - always fresh)
    const typeDocSnap = await getDoc(doc(db, 'interviewTypes', interviewType))
    if (typeDocSnap.exists()) {
      const typeData = typeDocSnap.data() as InterviewTypeRecord
      if (typeData.criteria) {
        console.log(`[Criteria] Using admin-defined criteria for ${interviewType}`)
        return typeData.criteria
      }
    }

    // Fall back to cached web search criteria (with TTL)
    const cacheDocSnap = await getDoc(doc(db, 'interviewCriteria', interviewType))
    if (!cacheDocSnap.exists()) return null

    const data = cacheDocSnap.data() as CachedCriteria
    const lastUpdated = new Date(data.lastUpdated)
    const ageMs = Date.now() - lastUpdated.getTime()
    const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000

    if (ageMs > ttlMs) {
      console.log(`[Criteria] Cache for ${interviewType} is stale`)
      return null
    }

    console.log(`[Criteria] Using cached criteria for ${interviewType}`)
    return data.criteria
  } catch (error) {
    console.error('[Criteria] Error fetching criteria:', error)
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

// =============================================================================
// Logs API
// =============================================================================

export interface LogEntry {
  timestamp: string
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'DEFAULT'
  functionName: string
  message: string
  executionId?: string
}

export interface FetchLogsParams {
  limit?: number
  severity?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
  hoursAgo?: number
}

export interface FetchLogsResponse {
  logs: LogEntry[]
  count: number
  filter: {
    severity?: string
    hoursAgo: number
    limit: number
  }
}

const FUNCTIONS_BASE_URL = 'https://us-central1-interview-analyzer-prod.cloudfunctions.net'

export async function fetchLogs(params: FetchLogsParams = {}): Promise<FetchLogsResponse> {
  const user = auth.currentUser
  if (!user) {
    throw new Error('Not authenticated')
  }

  const idToken = await user.getIdToken()

  const queryParams = new URLSearchParams()
  if (params.limit) queryParams.set('limit', params.limit.toString())
  if (params.severity) queryParams.set('severity', params.severity)
  if (params.hoursAgo) queryParams.set('hoursAgo', params.hoursAgo.toString())

  const url = `${FUNCTIONS_BASE_URL}/fetchLogs?${queryParams.toString()}`

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${idToken}`,
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || `HTTP ${response.status}`)
  }

  return response.json()
}

// =============================================================================
// Interview Types API
// =============================================================================

export interface InterviewTypeRecord {
  id: string
  name: string
  criteria: string
  createdAt: string
  updatedAt: string
  isBuiltIn?: boolean
}

export async function getInterviewTypes(): Promise<InterviewTypeRecord[]> {
  const snapshot = await getDocs(collection(db, 'interviewTypes'))
  const types: InterviewTypeRecord[] = []
  snapshot.forEach((doc) => {
    types.push({ id: doc.id, ...doc.data() } as InterviewTypeRecord)
  })
  return types.sort((a, b) => a.name.localeCompare(b.name))
}

export function subscribeToInterviewTypes(
  callback: (types: InterviewTypeRecord[]) => void
): Unsubscribe {
  return onSnapshot(collection(db, 'interviewTypes'), (snapshot) => {
    const types: InterviewTypeRecord[] = []
    snapshot.forEach((doc) => {
      types.push({ id: doc.id, ...doc.data() } as InterviewTypeRecord)
    })
    callback(types.sort((a, b) => a.name.localeCompare(b.name)))
  })
}

export async function createInterviewType(
  id: string,
  name: string,
  criteria: string
): Promise<void> {
  const now = new Date().toISOString()
  await setDoc(doc(db, 'interviewTypes', id), {
    name,
    criteria,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateInterviewType(
  id: string,
  name: string,
  criteria: string
): Promise<void> {
  await updateDoc(doc(db, 'interviewTypes', id), {
    name,
    criteria,
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteInterviewType(id: string): Promise<void> {
  await deleteDoc(doc(db, 'interviewTypes', id))
}
