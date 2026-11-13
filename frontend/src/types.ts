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
  { id: 'generic', name: 'General Interview' },
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
  const length = 16
  const maxValid = Math.floor(256 / chars.length) * chars.length
  let result = ''
  while (result.length < length) {
    const bytes = new Uint8Array(length * 2)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte < maxValid) {
        result += chars.charAt(byte % chars.length)
        if (result.length === length) break
      }
    }
  }
  return result
}
