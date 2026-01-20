export interface AnalysisData {
  userId: string
  interviewType: string
  transcriptFileName: string
  transcriptContent?: string
  analysis: string
  title: string
  savedAt?: string
  createdAt: string
  updatedAt?: string
  shareId?: string
  shareMode?: 'private' | 'anyone' | 'specific'
  sharedWith?: string[]
}

export interface InterviewType {
  id: string
  name: string
}

export const INTERVIEW_TYPES: InterviewType[] = [
  { id: 'google-apm', name: 'Google APM' },
  { id: 'meta-pm', name: 'Meta PM' },
  { id: 'amazon-pm', name: 'Amazon PM' },
  { id: 'generic', name: 'Generic PM' },
]

export function getInterviewTypeLabel(type: string): string {
  const found = INTERVIEW_TYPES.find(t => t.id === type)
  return found?.name || type
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return `${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export function generateShareId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let result = ''
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
