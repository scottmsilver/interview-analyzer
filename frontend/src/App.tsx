import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, Outlet, useOutletContext, useLocation } from 'react-router-dom'
import 'github-markdown-css/github-markdown-light.css'
import 'highlight.js/styles/github.css'
import './App.css'
import { Login } from './Login'
import { Admin } from './Admin'
import { History } from './History'
import { AnalysisView } from './AnalysisView'
import { SharedView } from './SharedView'
import { Layout } from './Layout'
import { Toast, AnalysisMarkdown, ActivityLog } from './components'
import { CopyIcon } from './icons'
import { useToast, useCopyToClipboard } from './hooks'
import { generateShareId, formatDateTime } from './types'
import {
  API_URL,
  subscribeToAuthState,
  isUserAdmin,
  getUser,
  createUser,
  subscribeToUserApproval,
  createAnalysis,
  getCachedCriteria,
  getInterviewTypes,
  type User,
  type UserRecord,
  type InterviewTypeRecord,
} from './api'

// Auth context type for child routes
export interface AuthContext {
  user: User
  userApproval: UserRecord
  isAdmin: boolean
}

// Hook for child components to access auth context
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useOutletContext<AuthContext>()
}

// Component for debug log entry
type Phase = { label: string; status: 'connected' | 'thinking' | 'waiting' }
type AnalysisMethod = 'direct-api' | 'agent-sdk' | 'pi-agent'

interface RawProgressMessage {
  content?: string
  raw?: {
    type?: string
    tool?: string
    [key: string]: unknown
  }
}

interface AnalysisPreset {
  id: string
  method: AnalysisMethod
  model: string
  label: string
  shortLabel: string
  description: string
  estimatedSeconds: number
}

const ANALYSIS_PRESETS: ReadonlyArray<AnalysisPreset> = [
  {
    id: 'pi-sonnet-5-5',
    method: 'pi-agent',
    model: 'claude-sonnet-5-5',
    label: 'Pi Fast — Sonnet 5.5',
    shortLabel: 'Pi Fast (Sonnet 5.5)',
    description: '~2 min • 7.6/10 quality, tool-verified',
    estimatedSeconds: 120,
  },
  {
    id: 'pi-gemini-4-hydrogen',
    method: 'pi-agent',
    model: 'gemini-4-hydrogen',
    label: 'Pi — Gemini 4 Hydrogen',
    shortLabel: 'Pi (Gemini 4 Hydrogen)',
    description: '~3.5 min • 7.9/10 quality, Gemini Pareto',
    estimatedSeconds: 207,
  },
  {
    id: 'pi-opus-5-5',
    method: 'pi-agent',
    model: 'claude-opus-5-5',
    label: 'Pi — Opus 5.5 ★ (Default)',
    shortLabel: 'Pi (Opus 5.5)',
    description: '~4 min • 8.5/10 quality, recommended',
    estimatedSeconds: 240,
  },
  {
    id: 'pi-fable-5-1',
    method: 'pi-agent',
    model: 'claude-fable-5-1',
    label: 'Pi Max — Fable 5.1',
    shortLabel: 'Pi Max (Fable 5.1)',
    description: '~6.5 min • 8.6/10 quality, deepest coaching',
    estimatedSeconds: 395,
  },
]

const TOOL_PHASE_LABELS: ReadonlyArray<[readonly string[], string]> = [
  [['analyze_transcript_metrics', 'extract_qa_turns'], 'Parsing transcript & talk metrics'],
  [['load_interview_rubric'], 'Loading role evaluation rubric'],
  [['audit_answer_quality', 'run_transcript_js'], 'Auditing answer structure & quotes'],
  [['verify_evaluation_draft'], 'Verifying timestamps & citations'],
]

/**
 * Map a progress message to a stable, human phase.
 *
 * Deliberately returns a fixed label rather than the message text. Reasoning
 * summaries stream in continuously, so echoing their content into the status
 * indicator produced a blur of half-finished sentences.
 */
function derivePhase(message: RawProgressMessage): Phase | null {
  const rawType = typeof message.raw?.type === 'string' ? message.raw.type : undefined
  const text = (message.content || '').toLowerCase()

  if (rawType === 'thinking_delta' || rawType === 'thinking_summary' || text.startsWith('thinking')) {
    return { label: 'Thinking through the evaluation', status: 'thinking' }
  }
  if (rawType === 'tool_use' || text.startsWith('using tool')) {
    const toolName = typeof message.raw?.tool === 'string' ? message.raw.tool.toLowerCase() : ''
    const toolText = `${toolName} ${text}`
    const matched = TOOL_PHASE_LABELS.find(([tools]) => tools.some((tool) => toolText.includes(tool)))
    return {
      label: matched ? matched[1] : 'Researching interview standards',
      status: 'connected',
    }
  }
  if (rawType === 'tool_result') {
    return { label: 'Reading research results', status: 'connected' }
  }
  if (rawType === 'text' || text.startsWith('writing')) {
    return { label: 'Writing the evaluation', status: 'connected' }
  }
  if (text.includes('waiting')) {
    return { label: 'Waiting for the model', status: 'waiting' }
  }
  if (text.includes('system:init') || text.includes('starting')) {
    return { label: 'Starting analysis', status: 'connected' }
  }
  // Unclassified traffic should not disturb whatever phase is showing.
  return null
}

// Shared authenticated layout - handles auth and renders header once
function AuthenticatedLayout() {
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [userApproval, setUserApproval] = useState<UserRecord | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authLoaded, setAuthLoaded] = useState(false)

  // Determine currentView from pathname
  const getCurrentView = (): 'main' | 'admin' | 'history' | 'analysis' => {
    const path = location.pathname
    if (path === '/admin') return 'admin'
    if (path === '/history') return 'history'
    if (path.startsWith('/analysis/')) return 'analysis'
    return 'main'
  }

  // Listen to Firebase auth state changes
  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (firebaseUser) => {
      setUser(firebaseUser)

      if (firebaseUser) {
        // Check if user is an admin
        const adminStatus = await isUserAdmin(firebaseUser.uid)
        setIsAdmin(adminStatus)

        // Check/create user approval document
        const existingUser = await getUser(firebaseUser.uid)

        if (!existingUser) {
          // Create new user document with pending status
          const newUserData: UserRecord = {
            approved: false,
            email: firebaseUser.email || '',
            createdAt: new Date().toISOString()
          }
          try {
            await createUser(firebaseUser.uid, newUserData)
            setUserApproval(newUserData)
          } catch (error) {
            console.error('Error creating user document:', error)
            setUserApproval(newUserData)
          }
        } else {
          setUserApproval(existingUser)
        }

        // Listen for real-time approval status updates
        const unsubscribeSnapshot = subscribeToUserApproval(firebaseUser.uid, (userData) => {
          if (userData) {
            setUserApproval(userData)
          }
        })

        setAuthLoaded(true)
        return () => unsubscribeSnapshot()
      } else {
        setUserApproval(null)
        setIsAdmin(false)
        setAuthLoaded(true)
      }
    })

    return () => unsubscribe()
  }, [])

  // Show nothing while loading to prevent flash
  if (!authLoaded) {
    return null
  }

  // Show login if not authenticated
  if (!user) {
    return <Login onLogin={() => setAuthLoaded(true)} />
  }

  // Show pending approval if not approved
  if (!userApproval || userApproval.approved !== true) {
    if (!userApproval) {
      return (
        <div className="app">
          <div className="container">
            <div className="loading">Loading...</div>
          </div>
        </div>
      )
    }

    return (
      <Layout user={user} isAdmin={isAdmin} currentView="main">
        <div className="pending-approval">
          <div className="pending-approval-card">
            <h2>Account Pending Approval</h2>
            <p>Thank you for signing up! Your account is currently pending approval.</p>
            <p>
              You'll receive access once an administrator approves your account.
              This typically happens within 24 hours.
            </p>
            <div className="pending-info">
              <p><strong>Email:</strong> {user.email}</p>
              <p><strong>Signed up:</strong> {new Date(userApproval.createdAt).toLocaleString()}</p>
            </div>
            <p className="pending-note">
              This page will automatically update when you're approved - no need to refresh!
            </p>
          </div>
        </div>
      </Layout>
    )
  }

  // Authenticated and approved - render layout with child routes
  return (
    <Layout user={user} isAdmin={isAdmin} currentView={getCurrentView()}>
      <Outlet context={{ user, userApproval, isAdmin } satisfies AuthContext} />
    </Layout>
  )
}

// Main analyze page content (no Layout wrapper - handled by AuthenticatedLayout)
function MainContent() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [interviewType, setInterviewType] = useState<string>('')
  const [interviewTypes, setInterviewTypes] = useState<InterviewTypeRecord[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string>('pi-opus-5-5')
  const selectedPreset = ANALYSIS_PRESETS.find((p) => p.id === selectedPresetId) ?? ANALYSIS_PRESETS[0]
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [agentLogs, setAgentLogs] = useState<{content: string, raw: unknown, at: number}[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [autoSaved, setAutoSaved] = useState(false)
  const [savedAnalysisId, setSavedAnalysisId] = useState<string | null>(null)
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [pastedText, setPastedText] = useState('')
  const [showMethodDropdown, setShowMethodDropdown] = useState(false)

  const { toastMessage, showToast } = useToast()
  const { copyMarkdownContent } = useCopyToClipboard(showToast)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'thinking' | 'waiting'>('idle')
  const [, setLastHeartbeat] = useState(Date.now()) // Used for triggering re-renders for heartbeat animation
  const [waitingStartTime, setWaitingStartTime] = useState<number | null>(null)
  const [waitingDuration, setWaitingDuration] = useState(0)
  const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Fetch interview types on mount
  useEffect(() => {
    getInterviewTypes().then((types) => {
      setInterviewTypes(types)
      // Set default to first type if not already set
      if (types.length > 0) {
        setInterviewType(prev => prev || types[0].id)
      }
    }).catch((err) => {
      console.error('Failed to fetch interview types:', err)
    })
  }, [])

  // Show warning in console if API URL might be misconfigured
  useEffect(() => {
    if (API_URL !== '' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        API_URL.includes('localhost')) {
      console.warn('⚠️ API URL is set to localhost but app is running in production!')
      console.warn('To fix this:')
      console.warn('1. Deploy your backend to a service like Heroku, Railway, or Render')
      console.warn('2. Create a .env.production file with VITE_API_URL=https://your-backend-url.com')
      console.warn('3. Rebuild and redeploy the frontend')
    }
  }, [])

  const saveAnalysis = useCallback(async (autoSave = false) => {
    if (!user || !analysis || !file) return null

    try {
      // Read the transcript content from the file
      const transcriptContent = await file.text()

      const now = new Date()
      const nowISO = now.toISOString()

      const analysisData = {
        userId: user.uid,
        interviewType,
        transcriptFileName: file.name,
        transcriptContent, // Store the actual transcript text
        analysis,
        title: `${file.name}`,
        savedAt: formatDateTime(nowISO),
        createdAt: nowISO,
        updatedAt: nowISO,
        // Sharing fields
        shareId: generateShareId(),
        shareMode: 'private' as 'private' | 'anyone' | 'specific',
        sharedWith: [] as string[]
      }

      const docId = await createAnalysis(analysisData)

      if (!autoSave) {
        showToast('✓ Saved')
      }

      return docId
    } catch (err) {
      console.error('Error saving analysis:', err)
      if (!autoSave) {
        showToast('× Failed')
      }
      return null
    }
  }, [user, analysis, file, interviewType, showToast])

  // Auto-save when analysis is complete but don't navigate
  useEffect(() => {
    if (analysis && !analyzing && user && file && !autoSaved) {
      // Wait a bit to ensure the analysis is fully loaded
      const timer = setTimeout(async () => {
        const docId = await saveAnalysis(true)
        setAutoSaved(true)
        setSavedAnalysisId(docId)
        // Show auto-save message briefly
        setStatusMessage('✅ Auto-saved to history')
        setTimeout(() => {
          setStatusMessage('')
        }, 2000)
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [analysis, analyzing, user, file, autoSaved, saveAnalysis])

  // Heartbeat effect for connection status
  useEffect(() => {
    if (analyzing) {
      const interval = setInterval(() => {
        setLastHeartbeat(Date.now())
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [analyzing])

  // Elapsed time effect for analysis progress
  useEffect(() => {
    if (analyzing && analysisStartTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - analysisStartTime) / 1000)
        setElapsedSeconds(elapsed)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [analyzing, analysisStartTime])

  // Waiting timer effect
  useEffect(() => {
    if (connectionStatus === 'waiting' && waitingStartTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - waitingStartTime) / 1000)
        setWaitingDuration(elapsed)
      }, 1000)
      return () => clearInterval(interval)
    } else {
      setWaitingDuration(0)
    }
  }, [connectionStatus, waitingStartTime])

  // Close method dropdown when clicking outside
  useEffect(() => {
    if (!showMethodDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.method-dropdown')) {
        setShowMethodDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showMethodDropdown])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError('')
      setAnalysis('')
    }
  }

  const handlePasteSubmit = () => {
    if (!pastedText.trim()) {
      setError('Please paste some text')
      return
    }

    // Create a File object from the pasted text
    const blob = new Blob([pastedText], { type: 'text/plain' })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    const file = new File([blob], `pasted-transcript-${timestamp}.txt`, { type: 'text/plain' })

    setFile(file)
    setError('')
    setAnalysis('')
    setShowPasteDialog(false)
    setPastedText('')
  }

  const analyzeInterview = async () => {
    if (!file) {
      setError('Please select a transcript file')
      return
    }

    setAnalyzing(true)
    setAnalysis('')
    setError('')
    setStatusMessage('Checking for cached criteria...')
    setConnectionStatus('connecting')
    setAgentLogs([])
    setAutoSaved(false)  // Reset auto-save flag for new analysis
    setSavedAnalysisId(null)  // Reset saved analysis ID
    setAnalysisStartTime(Date.now())
    setElapsedSeconds(0)

    // Try to get cached criteria from Firestore
    let cachedCriteria: string | null = null
    try {
      cachedCriteria = await getCachedCriteria(interviewType)
      if (cachedCriteria) {
        setStatusMessage('Using cached interview criteria...')
        setAgentLogs(prev => [...prev, {
          content: '[system] Using cached interview criteria (skipping web search)',
          raw: { type: 'cache_hit', interviewType },
          at: Date.now()
        }])
      } else {
        setStatusMessage('No cached criteria, will research current standards...')
      }
    } catch (err) {
      console.warn('Failed to fetch cached criteria:', err)
      // Continue without cache
    }

    setStatusMessage('Connecting to AI agent...')

    const formData = new FormData()
    formData.append('transcript', file)
    formData.append('interviewType', interviewType)
    formData.append('method', selectedPreset.method)
    formData.append('model', selectedPreset.model)
    if (cachedCriteria) {
      formData.append('cachedCriteria', cachedCriteria)
    }

    try {
      const idToken = await user.getIdToken()
      const response = await fetch(`${API_URL}/api/analyze/stream`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      })

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`
        try {
          const errorData = await response.json() as { error?: string }
          if (errorData?.error) {
            errorMessage = errorData.error
          }
        } catch {
          // Ignore non-JSON error responses
        }
        throw new Error(errorMessage)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)

            try {
              const message = JSON.parse(data)

              // Store both content and raw message
              if (message.type === 'raw') {
                setAgentLogs(prev => [...prev, {
                  content: message.content,
                  raw: message.raw || message,
                  at: Date.now()
                }])

                // The status line shows a steady phase, not live reasoning text.
                // Reasoning arrives in short bursts many times a second; putting
                // it here made the indicator flicker with half-sentences.
                // The full detail still goes to the activity log above.
                const phase = derivePhase(message)
                if (phase) {
                  setStatusMessage(phase.label)
                  setConnectionStatus(phase.status)
                  setWaitingStartTime(phase.status === 'waiting' ? (waitingStartTime || Date.now()) : null)
                }
                setLastHeartbeat(Date.now())
              } else if (message.type === 'result') {
                setAnalysis(prev => prev + message.content)
                setStatusMessage('Rendering analysis...')
                setConnectionStatus('connected')
                setAnalyzing(false)
                // Auto-save will be triggered after all messages are processed
              } else if (message.type === 'complete') {
                setAnalyzing(false)
                setStatusMessage('Analysis complete!')
                setConnectionStatus('idle')
              } else if (message.type === 'error') {
                setError(message.content || 'Analysis failed')
                setAnalyzing(false)
                setConnectionStatus('idle')
              }
            } catch (e) {
              console.error('Parse error:', e)
            }
          }
        }
      }

    } catch (err) {
      console.error('Analysis error:', err)
      setError(err instanceof Error ? err.message : 'Analysis failed')
      setAnalyzing(false)
      setConnectionStatus('idle')
    }
  }

  // Content rendered inside AuthenticatedLayout (no Layout wrapper needed)
  return (
    <>
      {!analysis && !analyzing && (
          <div className="welcome-section">
            <div className="upload-bar-centered">
              <select
                value={interviewType}
                onChange={(e) => setInterviewType(e.target.value)}
                disabled={analyzing}
                className="select-compact"
              >
                {interviewTypes.map(type => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>

              <div className="file-input-group">
                <label className="file-label-compact">
                  <input
                    type="file"
                    accept=".txt"
                    onChange={handleFileChange}
                    disabled={analyzing}
                    className="file-input"
                  />
                  <span className="file-button-compact">
                    {file ? `✓ ${file.name}` : 'Choose file'}
                  </span>
                </label>

                <span className="file-separator">or</span>

                <button
                  onClick={() => setShowPasteDialog(true)}
                  disabled={analyzing}
                  className="paste-button-compact"
                >
                  Paste text
                </button>
              </div>

              <div className="method-dropdown">
                <button
                  type="button"
                  onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                  disabled={analyzing}
                  className="method-trigger"
                >
                  {selectedPreset.shortLabel}
                  <span className="dropdown-arrow">▾</span>
                </button>
                {showMethodDropdown && (
                  <div className="method-options">
                    {ANALYSIS_PRESETS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`method-option ${selectedPreset.id === option.id ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedPresetId(option.id)
                          setShowMethodDropdown(false)
                        }}
                      >
                        <span className="method-name">{option.label}</span>
                        <span className="method-desc">{option.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={analyzeInterview}
                disabled={!file || analyzing}
                className="analyze-button-compact"
              >
                {analyzing ? (
                  <>
                    <span className="jumping-dino">🦖</span>
                    <span>Analyzing...</span>
                  </>
                ) : (
                  'Analyze'
                )}
              </button>
            </div>

            <div className="welcome-content-wrapper">
              <div className="welcome-illustration">
                <img src="/coffee-welcome.png" alt="Coffee cup with succulent" className="welcome-image" />
              </div>
              <div className="welcome-content">
                <h2 className="welcome-title">Welcome to Your Interview Analysis Journey</h2>
                <p className="welcome-message">
                  Take a deep breath. You've got this!
                </p>
                <p className="welcome-subtitle">
                  Get thoughtful, constructive feedback on your interview practice.
                </p>
                <p className="welcome-subtitle">
                  Default Pi analysis takes about 3 to 4 minutes (or ~2 minutes in Pi Fast mode).
                </p>
              </div>
            </div>
          </div>
        )}

        {analyzing && !analysis && (
          <div className="brewing-section">
            <div className="brewing-container">
              <div className="coffee-cup-brewing">
                <div className="steam-container">
                  <div className="steam steam-1"></div>
                  <div className="steam steam-2"></div>
                  <div className="steam steam-3"></div>
                </div>
                <div className="cup-body">☕</div>
              </div>
              <h2 className="brewing-title">Brewing Your Analysis...</h2>
              <div className="time-estimate">
                {(() => {
                  const estimatedTotal = selectedPreset.estimatedSeconds
                  const minutes = Math.floor(elapsedSeconds / 60)
                  const seconds = elapsedSeconds % 60
                  const remaining = Math.max(0, estimatedTotal - elapsedSeconds)
                  const remainingMin = Math.floor(remaining / 60)
                  const remainingSec = remaining % 60

                  return (
                    <>
                      <span className="time-elapsed">
                        {minutes}:{seconds.toString().padStart(2, '0')}
                      </span>
                      <span className="time-separator">/</span>
                      <span className="time-remaining">
                        ~{remainingMin}:{remainingSec.toString().padStart(2, '0')} remaining
                      </span>
                    </>
                  )
                })()}
              </div>
              <div className="progress-bar-container">
                {(() => {
                  const steps = ['Initializing', 'Reading', 'Analyzing', 'Evaluating', 'Writing']
                  let currentStep = 0
                  if (agentLogs.length > 0) currentStep = 1
                  if (agentLogs.length > 3) currentStep = 2
                  if (agentLogs.length > 8) currentStep = 3
                  if (agentLogs.length > 15) currentStep = 4

                  return (
                    <>
                      <div className="progress-steps-horizontal">
                        {steps.map((step, idx) => (
                          <div
                            key={step}
                            className={`progress-dot ${idx < currentStep ? 'completed' : ''} ${idx === currentStep ? 'active' : ''}`}
                          >
                            <span className="dot"></span>
                            <span className="dot-label">{step}</span>
                          </div>
                        ))}
                      </div>
                      <div className="progress-line">
                        <div className="progress-fill" style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}></div>
                      </div>
                    </>
                  )
                })()}
              </div>
              {agentLogs.length > 0 && (
                /* The steady phase, never raw log text. This previously showed
                   the last message truncated to 80 characters, which meant a
                   sliding window of the model's own prose scrolled under the
                   progress bar for the whole run. Detail belongs in the
                   activity log. */
                <div className="latest-activity">
                  {statusMessage || 'Starting analysis'}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="error-box">
            {error}
          </div>
        )}

        {agentLogs.length > 0 && (
          <div className={`thinking-flyout ${showLogs ? 'open' : 'closed'}`}>
            <div className="flyout-header">
              <div className="flyout-title-section">
                <span className="connection-indicator">
                  {connectionStatus === 'connecting' && <span className="pulse-dot connecting" />}
                  {connectionStatus === 'connected' && <span className="pulse-dot connected" />}
                  {connectionStatus === 'thinking' && <span className="pulse-dot thinking" />}
                  {connectionStatus === 'waiting' && <span className="pulse-dot waiting" />}
                  {connectionStatus === 'idle' && <span className="pulse-dot idle" />}
                </span>
                <span className="flyout-title">
                  {connectionStatus === 'connecting' && 'Connecting to agent...'}
                  {connectionStatus === 'connected' && 'Talking to agent'}
                  {connectionStatus === 'thinking' && 'Agent thinking...'}
                  {connectionStatus === 'waiting' && (
                    <>
                      Waiting for agent
                      {waitingDuration > 0 && (
                        <span className="waiting-timer"> ({waitingDuration}s)</span>
                      )}
                    </>
                  )}
                  {connectionStatus === 'idle' && 'Agent ready'}
                  <span className="log-count">({agentLogs.length})</span>
                </span>
              </div>
              <div className="flyout-actions">
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="flyout-toggle"
                  title={showLogs ? "Minimize" : "Expand"}
                >
                  {showLogs ? '−' : '+'}
                </button>
              </div>
            </div>
            {showLogs && (
              <div className="flyout-content">
                <ActivityLog entries={agentLogs} startedAt={analysisStartTime} />
              </div>
            )}
          </div>
        )}

        {analysis && (
          <div className="results">
            <div className="results-actions">
              {statusMessage && (
                <span className="auto-saved-indicator">{statusMessage}</span>
              )}
              {savedAnalysisId && (
                <button
                  onClick={() => navigate(`/analysis/${savedAnalysisId}`)}
                  className="view-analysis-button"
                  title="View saved analysis"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 2H14V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 9V14H2V4H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>View Analysis</span>
                </button>
              )}
              <button
                onClick={() => copyMarkdownContent('.markdown-body', analysis)}
                className="copy-button"
                title="Copy to clipboard"
              >
                <CopyIcon />
              </button>
            </div>

            <AnalysisMarkdown content={analysis} />
          </div>
        )}

      {/* Paste Dialog */}
      {showPasteDialog && (
        <div className="dialog-overlay" onClick={() => setShowPasteDialog(false)}>
          <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Paste Transcript Text</h3>
              <button
                className="dialog-close"
                onClick={() => {
                  setShowPasteDialog(false)
                  setPastedText('')
                }}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <textarea
                className="paste-textarea"
                placeholder="Paste your interview transcript here..."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="dialog-footer">
              <button
                className="dialog-button cancel"
                onClick={() => {
                  setShowPasteDialog(false)
                  setPastedText('')
                }}
              >
                Cancel
              </button>
              <button
                className="dialog-button submit"
                onClick={handlePasteSubmit}
                disabled={!pastedText.trim()}
              >
                Use This Text
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast message={toastMessage} />
    </>
  )
}

// Router wrapper component
function App() {
  return (
    <Router>
      <Routes>
        {/* Public route - no auth needed */}
        <Route path="/shared/:shareId" element={<SharedView />} />

        {/* Protected routes with shared layout */}
        <Route element={<AuthenticatedLayout />}>
          <Route path="/" element={<MainContent />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/history" element={<History />} />
          <Route path="/analysis/:analysisId" element={<AnalysisView />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
