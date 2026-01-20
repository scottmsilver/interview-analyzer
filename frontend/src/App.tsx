import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import 'github-markdown-css/github-markdown-light.css'
import 'highlight.js/styles/github.css'
import './App.css'
import { Login } from './Login'
import { Admin } from './Admin'
import { History } from './History'
import { AnalysisView } from './AnalysisView'
import { SharedView } from './SharedView'
import { Layout } from './Layout'
import { Toast, AnalysisMarkdown } from './components'
import { CopyIcon } from './icons'
import { useToast, useCopyToClipboard } from './hooks'
import { INTERVIEW_TYPES, generateShareId, formatDateTime } from './types'
import {
  subscribeToAuthState,
  isUserAdmin,
  getUser,
  createUser,
  subscribeToUserApproval,
  createAnalysis,
  type User,
  type UserRecord,
} from './api'

// UserRecord from API already has: approved, email, createdAt, approvedAt?

// Component for debug log entry
function DebugLogEntry({ log }: { log: { content: string, raw: any } }) {
  const [showRaw, setShowRaw] = useState(false)

  // Determine which robot is speaking based on message type
  const getRobotType = (_raw: any, content: string): 'agent' | 'system' | 'tool' => {
    if (content.includes('tool') || content.includes('Tool') || content.includes('Executing')) return 'tool'
    if (content.includes('System') || content.includes('SDK')) return 'system'
    return 'agent'
  }

  const robotType = getRobotType(log.raw, log.content)

  // Parse and format tool use messages
  const parseToolUse = (raw: any, content: string) => {
    // Handle bracketed system messages
    if (content.startsWith('[') && content.includes(']')) {
      const match = content.match(/^\[(.*?)\](.*)/)
      if (match) {
        const [, messageType, rest] = match
        const cleanType = messageType.toLowerCase()

        if (cleanType === 'system:init') {
          return {
            formatted: '→ System: Initializing agent...',
            type: 'system-request'
          }
        } else if (cleanType === 'system message' || cleanType === 'system') {
          return {
            formatted: '→ System: Processing request...',
            type: 'system-request'
          }
        } else if (cleanType === 'assistant') {
          const message = rest?.trim()
          if (message?.toLowerCase().includes('tool') || message?.toLowerCase().includes('search')) {
            return {
              formatted: `→ Agent: ${message || 'Preparing to execute tools...'}`,
              type: 'agent-thinking'
            }
          }
          return {
            formatted: `→ Agent: ${message || 'Processing...'}`,
            type: 'agent-response'
          }
        } else if (cleanType.includes('error')) {
          return {
            formatted: `⚠ Error: ${rest?.trim() || messageType}`,
            type: 'error'
          }
        } else if (cleanType === 'user message from sdk') {
          return {
            formatted: '→ System: Request received',
            type: 'system-request'
          }
        } else if (cleanType === 'streaming...' || cleanType === 'stream_delta') {
          return {
            formatted: '← Agent: Composing response...',
            type: 'agent-response'
          }
        } else if (cleanType.includes('tool progress')) {
          return {
            formatted: `  ↳ ${rest?.trim() || 'Executing...'}`,
            type: 'tool-execution'
          }
        } else {
          // For other bracketed messages, show as system
          return {
            formatted: `→ System: ${messageType.replace(/:/g, ' ').replace(/_/g, ' ')}`,
            type: 'system-request'
          }
        }
      }
    }

    // Handle tool_result messages
    if (raw?.type === 'tool_result') {
      const content = raw.content || raw.result || ''
      if (typeof content === 'string') {
        // Truncate long results
        const preview = content.slice(0, 60)
        return {
          formatted: `  ✓ Result: ${preview}${content.length > 60 ? '...' : ''}`,
          type: 'tool-result'
        }
      }
      return {
        formatted: `  ✓ Result received`,
        type: 'tool-result'
      }
    }

    // Handle text messages
    if (raw?.type === 'text' && raw?.text) {
      const text = raw.text.slice(0, 80)
      return {
        formatted: `Agent: ${text}${raw.text.length > 80 ? '...' : ''}`,
        type: 'text'
      }
    }

    // Handle thinking messages
    if (raw?.type === 'thinking' || (typeof raw === 'string' && raw.includes('thinking'))) {
      return {
        formatted: `Thinking...`,
        type: 'thinking'
      }
    }

    // Handle tool_use messages
    if (raw?.type === 'tool_use' && raw?.tool) {
      const tool = raw.tool
      const input = raw.input || {}

      // Format based on tool type
      switch (tool) {
        case 'WebSearch':
          return {
            formatted: `  ↳ Executing: WebSearch("${input.query || 'web search'}")`,
            type: 'tool-execution'
          }
        case 'WebFetch':
          return {
            formatted: `  ↳ Executing: WebFetch(${input.url ? new URL(input.url).hostname : 'webpage'})`,
            type: 'tool-execution'
          }
        case 'Read':
          return {
            formatted: `  ↳ Executing: Read(${input.file_path ? input.file_path.split('/').pop() : 'file'})`,
            type: 'tool-execution'
          }
        case 'Write':
          return {
            formatted: `  ↳ Executing: Write(${input.file_path ? input.file_path.split('/').pop() : 'file'})`,
            type: 'tool-execution'
          }
        case 'Edit':
          return {
            formatted: `  ↳ Executing: Edit(${input.file_path ? input.file_path.split('/').pop() : 'file'})`,
            type: 'tool-execution'
          }
        case 'Bash':
          return {
            formatted: `  ↳ Executing: Bash(${input.command ? input.command.slice(0, 40) : 'command'})`,
            type: 'tool-execution'
          }
        case 'TodoWrite':
          return {
            formatted: `  ↳ Executing: TodoWrite(updating task list)`,
            type: 'tool-execution'
          }
        case 'Grep':
          return {
            formatted: `  ↳ Executing: Grep("${input.pattern || 'pattern'}")`,
            type: 'tool-execution'
          }
        case 'Glob':
          return {
            formatted: `  ↳ Executing: Glob(${input.pattern || 'pattern'})`,
            type: 'tool-execution'
          }
        default:
          return {
            formatted: `  ↳ Executing: ${tool}(${input.description || JSON.stringify(input).slice(0, 30)})`,
            type: 'tool-execution'
          }
      }
    }

    // Check if it's a simple "Using tool" message
    if (typeof log.content === 'string' && log.content.startsWith('Using tool:')) {
      const toolName = log.content.replace('Using tool:', '').trim()
      return {
        formatted: `${toolName}()`,
        type: 'tool'
      }
    }

    return null
  }

  const toolParsed = parseToolUse(log.raw, log.content)

  // If we successfully parsed a message, use that
  const messageText = toolParsed ? toolParsed.formatted : log.content

  // Robot emojis
  const robots = {
    agent: '🤖',
    tool: '🔧',
    system: '⚙️'
  }

  return (
    <div className={`robot-message robot-message-${robotType}`}>
      <div className="robot-avatar">{robots[robotType]}</div>
      <div className="robot-bubble">
        <div className="robot-message-text">{messageText}</div>
        {showRaw && (
          <div className="robot-debug">
            <pre>{JSON.stringify(log.raw, null, 2)}</pre>
          </div>
        )}
      </div>
      <button
        className="robot-details-toggle"
        onClick={() => setShowRaw(!showRaw)}
        title={showRaw ? "Hide details" : "Show details"}
      >
        {showRaw ? '−' : '+'}
      </button>
    </div>
  )
}

function MainApp() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [userApproval, setUserApproval] = useState<UserRecord | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [interviewType, setInterviewType] = useState<string>('google-apm')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [agentLogs, setAgentLogs] = useState<{content: string, raw: any}[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [isReplaying, setIsReplaying] = useState(false)
  const [replayIndex, setReplayIndex] = useState(0)
  const [autoSaved, setAutoSaved] = useState(false)
  const [savedAnalysisId, setSavedAnalysisId] = useState<string | null>(null)
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [pastedText, setPastedText] = useState('')

  const { toastMessage, showToast } = useToast()
  const { copyMarkdownContent } = useCopyToClipboard(showToast)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'thinking' | 'waiting'>('idle')
  const [, setLastHeartbeat] = useState(Date.now()) // Used for triggering re-renders for heartbeat animation
  const [waitingStartTime, setWaitingStartTime] = useState<number | null>(null)
  const [waitingDuration, setWaitingDuration] = useState(0)
  const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // API URL configuration
  // In production, you need to deploy your backend somewhere (e.g., Heroku, Railway, Render)
  // and update this URL accordingly
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:9002'

  // Show warning in console if API URL might be misconfigured
  useEffect(() => {
    if (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        API_URL.includes('localhost')) {
      console.warn('⚠️ API URL is set to localhost but app is running in production!')
      console.warn('To fix this:')
      console.warn('1. Deploy your backend to a service like Heroku, Railway, or Render')
      console.warn('2. Create a .env.production file with VITE_API_URL=https://your-backend-url.com')
      console.warn('3. Rebuild and redeploy the frontend')
    }
  }, [])

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
            // Set user approval anyway so they see the pending screen
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

        setLoading(false)
        return () => unsubscribeSnapshot()
      } else {
        setUserApproval(null)
        setIsAdmin(false)
        setLoading(false)
      }
    })

    // Cleanup subscription
    return () => unsubscribe()
  }, [])

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
  }, [analysis, analyzing, user, file, autoSaved])

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

  // Replay animation effect
  useEffect(() => {
    if (isReplaying && replayIndex < agentLogs.length) {
      const timer = setTimeout(() => {
        setReplayIndex(replayIndex + 1)
      }, 400) // 400ms between messages
      return () => clearTimeout(timer)
    } else if (isReplaying && replayIndex >= agentLogs.length) {
      setIsReplaying(false)
    }
  }, [isReplaying, replayIndex, agentLogs.length])

  // Keep replay index in sync with logs when not replaying
  useEffect(() => {
    if (!isReplaying) {
      setReplayIndex(agentLogs.length)
    }
  }, [agentLogs.length, isReplaying])

  const startReplay = () => {
    setReplayIndex(0)
    setIsReplaying(true)
  }

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

  const saveAnalysis = async (autoSave = false) => {
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
  }

  const analyzeInterview = async () => {
    if (!file) {
      setError('Please select a transcript file')
      return
    }

    setAnalyzing(true)
    setAnalysis('')
    setError('')
    setStatusMessage('Connecting to AI agent...')
    setConnectionStatus('connecting')
    setAgentLogs([])
    setAutoSaved(false)  // Reset auto-save flag for new analysis
    setSavedAnalysisId(null)  // Reset saved analysis ID
    setAnalysisStartTime(Date.now())
    setElapsedSeconds(0)

    const formData = new FormData()
    formData.append('transcript', file)
    formData.append('interviewType', interviewType)

    try {
      const response = await fetch(`${API_URL}/api/analyze/stream`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
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
                  raw: message.raw || message
                }])
                setStatusMessage(message.content)
                // Update connection status based on message content
                const lowerContent = message.content.toLowerCase()
                if (lowerContent.includes('thinking') || lowerContent.includes('evaluating')) {
                  setConnectionStatus('thinking')
                  setWaitingStartTime(null)
                } else if (lowerContent.includes('waiting')) {
                  setConnectionStatus('waiting')
                  if (!waitingStartTime) {
                    setWaitingStartTime(Date.now())
                  }
                } else {
                  setConnectionStatus('connected')
                  setWaitingStartTime(null)
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


  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="app">
        <div className="container">
          <div className="loading">Loading...</div>
        </div>
      </div>
    )
  }

  // Show login if not authenticated
  if (!user) {
    return <Login onLogin={() => setLoading(false)} />
  }

  // Show pending approval message if not approved (must be explicitly approved)
  // Also catches the case where userApproval is null/undefined
  if (user && (!userApproval || userApproval.approved !== true)) {
    // If userApproval hasn't loaded yet, show loading state
    if (!userApproval) {
      return (
        <div className="app">
          <div className="container">
            <div className="loading">Loading...</div>
          </div>
        </div>
      )
    }

    // Show the full pending approval screen
    return (
      <Layout user={user} isAdmin={isAdmin} currentView="main">
        <div className="pending-approval">
          <div className="pending-approval-card">
            <h2>⏳ Account Pending Approval</h2>
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

  // At this point, user is authenticated, approved, and not an admin
  return (
    <Layout user={user} isAdmin={isAdmin} currentView="main">
        {!analysis && !analyzing && (
          <div className="welcome-section">
            <div className="upload-bar-centered">
              <select
                value={interviewType}
                onChange={(e) => setInterviewType(e.target.value)}
                disabled={analyzing}
                className="select-compact"
              >
                {INTERVIEW_TYPES.map(type => (
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
                  Upload your interview transcript above for thoughtful, constructive feedback.
                  Analysis takes about 2 minutes.
                </p>
                <div className="welcome-tips">
                  <div className="tip">
                    <svg className="tip-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M14 5L6 13L2 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="tip-text">Upload text transcript</span>
                  </div>
                  <div className="tip">
                    <svg className="tip-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="8" cy="8" r="2" fill="currentColor"/>
                    </svg>
                    <span className="tip-text">Company-specific insights</span>
                  </div>
                  <div className="tip">
                    <svg className="tip-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 14H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <span className="tip-text">Actionable feedback</span>
                  </div>
                </div>
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
                  const estimatedTotal = 120 // 2 minutes in seconds
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
                <div className="latest-activity">
                  {(() => {
                    const lastLog = agentLogs[agentLogs.length - 1]
                    const content = lastLog?.content || ''
                    const cleaned = content.replace(/^\[.*?\]/, '').trim()
                    return cleaned.length > 80 ? cleaned.substring(0, 80) + '...' : cleaned || 'Processing...'
                  })()}
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
                {/* Live Conversation - two robots with thought balloons */}
                <div className="robot-scene">
                  {/* Replay button */}
                  {!analyzing && agentLogs.length > 0 && (
                    <button
                      onClick={startReplay}
                      className="replay-button"
                      disabled={isReplaying}
                      title="Replay animation"
                    >
                      {isReplaying ? '⏸' : '▶'} Replay
                    </button>
                  )}

                  {/* Agent Robot (left) */}
                  <div className="robot-character robot-character-agent">
                    {(() => {
                      const logsToShow = isReplaying ? agentLogs.slice(0, replayIndex) : agentLogs
                      const lastAgentMsg = [...logsToShow].reverse().find(log => {
                        const content = log.content.toLowerCase()
                        return !content.includes('system') && !content.includes('sdk') &&
                               !content.includes('tool') && !content.includes('executing')
                      })
                      const agentText = lastAgentMsg ?
                        (lastAgentMsg.content.startsWith('[') ?
                          lastAgentMsg.content.match(/\](.*)/)?.[1]?.trim() || 'Thinking...' :
                          lastAgentMsg.content.substring(0, 80) + (lastAgentMsg.content.length > 80 ? '...' : '')) :
                        'Ready...'

                      return (
                        <>
                          {lastAgentMsg && (
                            <div className="thought-balloon thought-balloon-left" key={logsToShow.indexOf(lastAgentMsg)}>
                              {agentText}
                            </div>
                          )}
                          <div className="robot-body">🤖</div>
                          <div className="robot-label">Agent</div>
                        </>
                      )
                    })()}
                  </div>

                  {/* System Robot (right) */}
                  <div className="robot-character robot-character-system">
                    {(() => {
                      const logsToShow = isReplaying ? agentLogs.slice(0, replayIndex) : agentLogs
                      const lastSystemMsg = [...logsToShow].reverse().find(log => {
                        const content = log.content.toLowerCase()
                        return content.includes('system') || content.includes('sdk') ||
                               content.includes('tool') || content.includes('executing')
                      })
                      const systemText = lastSystemMsg ?
                        (lastSystemMsg.content.startsWith('[') ?
                          lastSystemMsg.content.match(/\](.*)/)?.[1]?.trim() || 'Processing...' :
                          lastSystemMsg.content.substring(0, 80) + (lastSystemMsg.content.length > 80 ? '...' : '')) :
                        'Ready...'

                      return (
                        <>
                          {lastSystemMsg && (
                            <div className="thought-balloon thought-balloon-right" key={logsToShow.indexOf(lastSystemMsg)}>
                              {systemText}
                            </div>
                          )}
                          <div className="robot-body">⚙️</div>
                          <div className="robot-label">System</div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* Debug Toggle */}
                <div className="debug-toggle-section">
                  <button
                    onClick={() => setShowDebug(!showDebug)}
                    className="debug-toggle-button"
                  >
                    {showDebug ? '▼' : '▶'} Debug Logs ({agentLogs.length})
                  </button>
                </div>

                {/* Debug Section - all logs */}
                {showDebug && (
                  <div className="debug-logs">
                    {agentLogs.map((log, i) => (
                      <DebugLogEntry key={i} log={log} />
                    ))}
                  </div>
                )}
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

    </Layout>
  )
}

// Router wrapper component
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/history" element={<History />} />
        <Route path="/analysis/:analysisId" element={<AnalysisView />} />
        <Route path="/shared/:shareId" element={<SharedView />} />
      </Routes>
    </Router>
  )
}

export default App
