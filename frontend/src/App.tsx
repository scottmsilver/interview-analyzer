import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'github-markdown-css/github-markdown-light.css'
import 'highlight.js/styles/github.css'
import './App.css'
import { Login } from './Login'
import { Admin } from './Admin'
import { Layout } from './Layout'
import { auth, db } from './firebase'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'

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

function MainApp() {
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
  const [agentLogs, setAgentLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(true)

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError('')
      setAnalysis('')
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
    setAgentLogs([])

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

              // Create detailed log entry based on message type
              const timestamp = new Date().toLocaleTimeString()
              let logEntry = ''

              if (message.type === 'thinking') {
                logEntry = `💭 ${timestamp} | THINKING: ${message.content || message.fullContent || 'Processing...'}`
                setStatusMessage('🤔 Agent is thinking...')
              } else if (message.type === 'tool_use') {
                logEntry = `🛠️ ${timestamp} | TOOL: ${message.content || message.tool || 'unknown'}`
                if (message.input) {
                  logEntry += `\n   Input: ${JSON.stringify(message.input).substring(0, 100)}`
                }
                setStatusMessage(message.content || 'Using tool...')
              } else if (message.type === 'tool_result') {
                logEntry = `✅ ${timestamp} | RESULT: ${message.content || 'Tool completed'}`
                setStatusMessage('Processing results...')
              } else if (message.type === 'progress') {
                logEntry = `📊 ${timestamp} | ${message.content}`
                setStatusMessage(message.content)
              } else if (message.type === 'complete') {
                logEntry = `✅ ${timestamp} | COMPLETE: Analysis finished`
                setAnalyzing(false)
                setStatusMessage('Analysis complete!')
              } else if (message.type === 'error') {
                logEntry = `❌ ${timestamp} | ERROR: ${message.message}`
                setError(message.message)
                setAnalyzing(false)
                setStatusMessage('Error occurred')
              } else if (message.type === 'result') {
                logEntry = `📝 ${timestamp} | OUTPUT: Generating final analysis...`
                setAnalysis(prev => prev + message.content)
                setStatusMessage('Rendering analysis...')
              } else if (message.content) {
                logEntry = `📝 ${timestamp} | ${message.type || 'MESSAGE'}: ${message.content.substring(0, 100)}`
                setAnalysis(prev => prev + message.content)
              } else {
                logEntry = `📋 ${timestamp} | ${message.type || 'UNKNOWN'}: ${JSON.stringify(message).substring(0, 100)}`
              }

              if (logEntry) {
                setAgentLogs(prev => [...prev, logEntry])
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

          <label className="file-label-compact">
            <input
              type="file"
              accept=".txt"
              onChange={handleFileChange}
              disabled={analyzing}
              className="file-input"
            />
            <span className="file-button-compact">
              {file ? `✓ ${file.name}` : 'Choose transcript'}
            </span>
          </label>

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

        {error && (
          <div className="error-box">
            {error}
          </div>
        )}

        {agentLogs.length > 0 && (
          <div className={`thinking-flyout ${showLogs ? 'open' : 'closed'}`}>
            <div className="flyout-header">
              <span className="flyout-title">💭 Agent Thinking ({agentLogs.length})</span>
              <div className="flyout-actions">
                {analyzing && statusMessage && (
                  <span className="flyout-status">{statusMessage}</span>
                )}
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="flyout-toggle"
                >
                  {showLogs ? '✕' : '▶'}
                </button>
              </div>
            </div>
            {showLogs && (
              <div className="flyout-content">
                {agentLogs.map((log, i) => (
                  <div key={i} className="log-entry">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                    >
                      {log}
                    </ReactMarkdown>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {analysis && (
          <div className="results">
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
                  alert('Copied to clipboard!')
                } else {
                  // Fallback to markdown text
                  navigator.clipboard.writeText(analysis)
                  alert('Copied to clipboard!')
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

      <footer className="footer">
        Interview Analyzer
      </footer>
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
      </Routes>
    </Router>
  )
}

export default App
