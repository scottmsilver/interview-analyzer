import { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'github-markdown-css/github-markdown-light.css'
import 'highlight.js/styles/github.css'
import './App.css'
import { Login } from './Login'
import { Admin } from './Admin'
import { History } from './History'
import { AnalysisView } from './AnalysisView'
import { Layout } from './Layout'
import { auth, db } from './firebase'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot, collection, addDoc } from 'firebase/firestore'

interface InterviewType {
  id: string
  name: string
}

const INTERVIEW_TYPES: InterviewType[] = [
  { id: 'google-apm', name: 'Google APM' },
  { id: 'meta-pm', name: 'Meta PM' },
  { id: 'amazon-pm', name: 'Amazon PM' },
  { id: 'generic', name: 'Generic PM' },
]

interface UserApproval {
  approved: boolean
  email: string
  createdAt: string
  approvedAt?: string
}

// Component for each log entry with raw data toggle
function LogEntry({ log }: { log: { content: string, raw: any } }) {
  const [showRaw, setShowRaw] = useState(false)

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
  if (toolParsed) {
    const cssClass = toolParsed.type === 'tool' ? 'log-entry-tool' :
                     toolParsed.type === 'tool-execution' ? 'log-entry-tool-execution' :
                     toolParsed.type === 'tool-result' ? 'log-entry-tool-result' :
                     toolParsed.type === 'result' ? 'log-entry-result' :
                     toolParsed.type === 'text' ? 'log-entry-text' :
                     toolParsed.type === 'thinking' ? 'log-entry-thinking' :
                     toolParsed.type === 'system-request' ? 'log-entry-system-request' :
                     toolParsed.type === 'agent-response' ? 'log-entry-agent-response' :
                     toolParsed.type === 'agent-thinking' ? 'log-entry-agent-thinking' :
                     toolParsed.type === 'system' ? 'log-entry-system' :
                     toolParsed.type === 'assistant' ? 'log-entry-assistant' :
                     toolParsed.type === 'error' ? 'log-entry-error' : 'log-entry'

    return (
      <div className="log-entry-wrapper">
        <div className={`log-entry ${cssClass}`}>
          <span className="log-entry-content">{toolParsed.formatted}</span>
          <button
            className="raw-toggle"
            onClick={() => setShowRaw(!showRaw)}
            title={showRaw ? "Hide details" : "Show details"}
          >
            {showRaw ? '−' : '+'}
          </button>
        </div>
        {showRaw && (
          <div className="raw-data">
            <pre>{JSON.stringify(log.raw, null, 2)}</pre>
          </div>
        )}
      </div>
    )
  }

  // Original logic for non-tool messages
  const getMessageType = (content: string) => {
    const lowerContent = content.toLowerCase()
    if (lowerContent.includes('error') || lowerContent.includes('failed')) return 'error'
    if (lowerContent.includes('success') || lowerContent.includes('complete')) return 'success'
    if (lowerContent.includes('analyzing') || lowerContent.includes('processing')) return 'processing'
    if (lowerContent.includes('waiting') || lowerContent.includes('connecting')) return 'waiting'
    if (lowerContent.includes('thinking') || lowerContent.includes('evaluating')) return 'thinking'
    if (lowerContent.includes('found') || lowerContent.includes('detected')) return 'found'
    return 'default'
  }

  const messageType = getMessageType(log.content)

  // Format the content for better readability
  const formatContent = (content: string) => {
    // Add line breaks after periods followed by capital letters
    return content.replace(/\. ([A-Z])/g, '.\n$1')
  }

  return (
    <div className="log-entry-wrapper">
      <div className={`log-entry log-entry-${messageType}`}>
        <span className="log-entry-icon">
          {messageType === 'error' && '×'}
          {messageType === 'success' && '✓'}
          {messageType === 'processing' && '•'}
          {messageType === 'waiting' && '◦'}
          {messageType === 'thinking' && '•'}
          {messageType === 'found' && '→'}
          {messageType === 'default' && '▸'}
        </span>
        <span className="log-entry-content">{formatContent(log.content)}</span>
        <button
          className="raw-toggle"
          onClick={() => setShowRaw(!showRaw)}
          title={showRaw ? "Hide details" : "Show details"}
        >
          {showRaw ? '−' : '+'}
        </button>
      </div>
      {showRaw && (
        <div className="raw-data">
          <pre>{JSON.stringify(log.raw, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

// Coffee Aroma Animation Component
function CoffeeAroma() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = 280
    canvas.height = 210

    const cupCenterX = canvas.width / 2
    const cupTopY = 90 // Position at the cup rim (y=35 in viewBox, scaled to canvas)

    // Narrow the starting spread for center emission
    const cupOpeningWidth = 8 // Tighter starting point

    class Swirl {
      trail: Array<{ x: number; y: number }>
      maxTrailLength: number
      yPos: number
      angle: number
      frameCount: number
      speedFactor: number
      startX: number
      resetThreshold: number

      constructor(startXOffset: number, initialAngle: number, speedFactor: number) {
        this.trail = []
        this.maxTrailLength = 150
        this.yPos = cupTopY
        this.angle = initialAngle
        this.frameCount = 0
        this.speedFactor = speedFactor
        // Start closer to center for tighter emission point
        this.startX = cupCenterX + (startXOffset * 0.3)
        this.resetThreshold = 50 // Top of visible area
      }

      update() {
        this.frameCount++

        // Calculate distance ratio for ease-out effect
        const distanceRatio = (this.yPos - this.resetThreshold) / (cupTopY - this.resetThreshold)

        // Slow down dramatically as it rises (cubic ease-out for more natural deceleration)
        const easeOutSpeed = 0.08 + (0.4 * distanceRatio * distanceRatio * distanceRatio)
        this.yPos -= easeOutSpeed * this.speedFactor

        // Reset when reaching top
        if (this.yPos < this.resetThreshold) {
          this.yPos = cupTopY
          this.trail = []
          this.frameCount = 0
        }

        // Swirl math with dramatic S-curves (slowed down)
        const time = this.frameCount * 0.02 * this.speedFactor
        const amplitude = Math.sin(time * 0.5) * 15 + 25
        this.angle += 0.025 * this.speedFactor

        const xPos = this.startX + Math.sin(this.angle) * amplitude

        // Add new position to trail
        this.trail.push({ x: xPos, y: this.yPos })

        // Maintain max length
        if (this.trail.length > this.maxTrailLength) {
          this.trail.shift()
        }
      }

      draw(context: CanvasRenderingContext2D) {
        if (this.trail.length < 2) return

        context.lineCap = 'round'

        for (let i = 1; i < this.trail.length; i++) {
          const p = this.trail[i]

          // Fade along the curve
          const trailOpacity = i / this.trail.length

          // Depth effect: thinner/lighter near center
          const deviation = Math.abs(p.x - cupCenterX)
          const maxDeviation = 60
          const depthFactor = 1 - Math.min(1, deviation / maxDeviation)

          // Line width and opacity with depth and trail fade
          const finalLineWidth = (0.8 + 1.5 * (1 - depthFactor)) * trailOpacity
          const depthOpacity = (0.5 + 0.4 * (1 - depthFactor))
          const finalOpacity = depthOpacity * trailOpacity

          // Use terracotta color
          context.strokeStyle = `rgba(199, 122, 75, ${finalOpacity})`
          context.lineWidth = finalLineWidth

          context.beginPath()
          context.moveTo(this.trail[i - 1].x, this.trail[i - 1].y)
          context.lineTo(p.x, p.y)
          context.stroke()
        }
      }
    }

    // Create multiple swirls with slower speeds
    const swirls = [
      new Swirl(0, 0, 0.8),
      new Swirl(-12, Math.PI / 2, 0.9),
      new Swirl(12, Math.PI, 0.7)
    ]

    let animationId: number

    function animate() {
      if (!ctx || !canvas) return

      // Clear with low opacity for trail effect
      ctx.fillStyle = 'rgba(253, 252, 251, 0.15)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Update and draw all swirls
      swirls.forEach(swirl => {
        swirl.update()
        swirl.draw(ctx)
      })

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [])

  return <canvas ref={canvasRef} className="coffee-canvas" />
}

function MainApp() {
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [user, setUser] = useState<User | null>(null)
  const [userApproval, setUserApproval] = useState<UserApproval | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [interviewType, setInterviewType] = useState<string>('google-apm')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [agentLogs, setAgentLogs] = useState<{content: string, raw: any}[]>([])
  const [showLogs, setShowLogs] = useState(true)
  const [autoSaved, setAutoSaved] = useState(false)
  const [savedAnalysisId, setSavedAnalysisId] = useState<string | null>(null)
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [pastedText, setPastedText] = useState('')
  const [toastMessage, setToastMessage] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'thinking' | 'waiting'>('idle')
  const [, setLastHeartbeat] = useState(Date.now()) // Used for triggering re-renders for heartbeat animation
  const [waitingStartTime, setWaitingStartTime] = useState<number | null>(null)
  const [waitingDuration, setWaitingDuration] = useState(0)

  // API URL configuration
  // In production, you need to deploy your backend somewhere (e.g., Heroku, Railway, Render)
  // and update this URL accordingly
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)

      if (firebaseUser) {
        // Check if user is an admin
        const adminRef = doc(db, 'admins', firebaseUser.uid)
        const adminSnap = await getDoc(adminRef)
        setIsAdmin(adminSnap.exists())

        // Check/create user approval document
        const userRef = doc(db, 'users', firebaseUser.uid)
        const userSnap = await getDoc(userRef)

        if (!userSnap.exists()) {
          // Create new user document with pending status
          const newUserData: UserApproval = {
            approved: false,
            email: firebaseUser.email || '',
            createdAt: new Date().toISOString()
          }
          try {
            await setDoc(userRef, newUserData)
            setUserApproval(newUserData)
          } catch (error) {
            console.error('Error creating user document:', error)
            // Set user approval anyway so they see the pending screen
            setUserApproval(newUserData)
          }
        } else {
          setUserApproval(userSnap.data() as UserApproval)
        }

        // Listen for real-time approval status updates
        const unsubscribeSnapshot = onSnapshot(userRef, (doc) => {
          if (doc.exists()) {
            setUserApproval(doc.data() as UserApproval)
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

  // Auto-dismiss toast quickly (1.5 seconds)
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage('')
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  // Heartbeat effect for connection status
  useEffect(() => {
    if (analyzing) {
      const interval = setInterval(() => {
        setLastHeartbeat(Date.now())
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [analyzing])

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

  const showToast = (message: string) => {
    setToastMessage(message)
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
      const dateStr = now.toLocaleDateString()
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

      const analysisData = {
        userId: user.uid,
        interviewType,
        transcriptFileName: file.name,
        transcriptContent, // Store the actual transcript text
        analysis,
        title: `${file.name}`,
        savedAt: `${dateStr} at ${timeStr}`,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }

      const docRef = await addDoc(collection(db, 'analyses'), analysisData)

      if (!autoSave) {
        showToast('✓ Saved')
      }

      return docRef.id
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

        <footer className="footer">
          Interview Analyzer
        </footer>
      </Layout>
    )
  }

  // At this point, user is authenticated, approved, and not an admin
  return (
    <Layout user={user} isAdmin={isAdmin} currentView="main">
      <div className="upload-card-horizontal">
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

        {!analysis && !analyzing && (
          <div className="welcome-section">
            <div className="welcome-illustration">
              <div className="coffee-cup-container">
                <svg className="coffee-cup-svg" width="280" height="210" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Narrow coffee cup - centered on mouth, taller */}
                  {/* Cup body - taller bowl shape */}
                  <path d="M45 35 Q43 48 46 58 L74 58 Q77 48 75 35 Z"
                        stroke="#c77a4b" strokeWidth="1.2" fill="none" opacity="0.6"/>

                  {/* Cup rim - front arc only */}
                  <path d="M45 35 Q60 37 75 35" stroke="#c77a4b" strokeWidth="1" fill="none" opacity="0.6"/>

                  {/* Elegant handle */}
                  <path d="M75 40 Q81 40 81 46 Q81 52 75 52"
                        stroke="#c77a4b" strokeWidth="1.2" fill="none" opacity="0.6" strokeLinecap="round"/>

                  {/* Saguaro cactus - BIG, to the right */}
                  {/* Main tall trunk */}
                  <path d="M94 58 L94 18" stroke="#738c5f" strokeWidth="7" fill="none" opacity="0.55" strokeLinecap="round"/>
                  <path d="M106 58 L106 18" stroke="#738c5f" strokeWidth="7" fill="none" opacity="0.55" strokeLinecap="round"/>

                  {/* Smaller left arm (higher up) */}
                  <path d="M94 32 Q88 32 88 26 L88 22" stroke="#738c5f" strokeWidth="5" fill="none" opacity="0.55" strokeLinecap="round"/>

                  {/* Bigger right arm (lower and longer) */}
                  <path d="M106 38 Q112 38 112 32 L112 24" stroke="#738c5f" strokeWidth="5.5" fill="none" opacity="0.55" strokeLinecap="round"/>

                  {/* Subtle spines as dots - sparse */}
                  <circle cx="100" cy="24" r="0.6" fill="#738c5f" opacity="0.35"/>
                  <circle cx="100" cy="32" r="0.6" fill="#738c5f" opacity="0.35"/>
                  <circle cx="100" cy="40" r="0.6" fill="#738c5f" opacity="0.35"/>
                </svg>
                <CoffeeAroma />
              </div>
            </div>
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
                <div className="current-status">
                  {statusMessage && (
                    <div className="status-message">
                      <span className="status-icon">→</span>
                      {statusMessage}
                    </div>
                  )}
                </div>
                <div className="log-entries">
                  {agentLogs.map((log, i) => (
                    <LogEntry key={i} log={log} />
                  ))}
                </div>
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
                onClick={() => {
                  const markdownBody = document.querySelector('.markdown-body')
                  if (markdownBody) {
                    // Copy the rendered HTML as rich text
                    const selection = window.getSelection()
                    const range = document.createRange()
                    range.selectNodeContents(markdownBody)
                    selection?.removeAllRanges()
                    selection?.addRange(range)
                    document.execCommand('copy')
                    selection?.removeAllRanges()
                    showToast('✓ Copied')
                  } else {
                    // Fallback to markdown text
                    navigator.clipboard.writeText(analysis)
                    showToast('✓ Copied')
                  }
                }}
                className="copy-button"
                title="Copy to clipboard"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.75 4.75H10.25V1.75H5.75V4.75ZM4.5 1.5C4.5 0.947715 4.94772 0.5 5.5 0.5H10.5C11.0523 0.5 11.5 0.947715 11.5 1.5V5C11.5 5.55228 11.0523 6 10.5 6H5.5C4.94772 6 4.5 5.55228 4.5 5V1.5Z" fill="currentColor"/>
                  <path d="M2.5 4.5C1.94772 4.5 1.5 4.94772 1.5 5.5V14C1.5 14.5523 1.94772 15 2.5 15H11C11.5523 15 12 14.5523 12 14V13H13.5V14C13.5 15.3807 12.3807 16.5 11 16.5H2.5C1.11929 16.5 0 15.3807 0 14V5.5C0 4.11929 1.11929 3 2.5 3H4V4.5H2.5Z" fill="currentColor" transform="translate(0.5, -0.5)"/>
                </svg>
              </button>
            </div>

            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {analysis}
              </ReactMarkdown>
            </div>
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

      <footer className="footer">
        Interview Analyzer
      </footer>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-notification">
          {toastMessage}
        </div>
      )}

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
      </Routes>
    </Router>
  )
}

export default App
