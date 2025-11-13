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

  return (
    <div className="log-entry-wrapper">
      <div className="log-entry">
        {log.content}
        <button
          className="raw-toggle"
          onClick={() => setShowRaw(!showRaw)}
          title={showRaw ? "Hide raw data" : "Show raw data"}
        >
          {showRaw ? '▼' : '▶'} raw
        </button>
      </div>
      {showRaw && (
        <div className="raw-data">
          {JSON.stringify(log.raw, null, 2)}
        </div>
      )}
    </div>
  )
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
  const [agentLogs, setAgentLogs] = useState<{content: string, raw: any}[]>([])
  const [showLogs, setShowLogs] = useState(true)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoSaved, setAutoSaved] = useState(false)

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

  // Auto-save when analysis is complete
  useEffect(() => {
    if (analysis && !analyzing && user && file && !autoSaved) {
      // Wait a bit to ensure the analysis is fully loaded
      const timer = setTimeout(() => {
        saveAnalysis(true)
        setAutoSaved(true)
        // Show auto-save message briefly
        setStatusMessage('✅ Auto-saved to history')
        setTimeout(() => {
          setStatusMessage('')
        }, 3000)
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [analysis, analyzing, user, file, autoSaved])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError('')
      setAnalysis('')
    }
  }

  const saveAnalysis = async (autoSave = false) => {
    if (!user || !analysis || !file) return

    setSaving(true)
    try {
      const now = new Date()
      const dateStr = now.toLocaleDateString()
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

      const analysisData = {
        userId: user.uid,
        interviewType,
        transcriptFileName: file.name,
        analysis,
        title: saveTitle || `${file.name}`,
        savedAt: `${dateStr} at ${timeStr}`,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }

      await addDoc(collection(db, 'analyses'), analysisData)

      if (!autoSave) {
        setShowSaveDialog(false)
        setSaveTitle('')
        alert('Analysis saved successfully!')
      }
    } catch (err) {
      console.error('Error saving analysis:', err)
      if (!autoSave) {
        alert('Failed to save analysis: ' + (err instanceof Error ? err.message : 'Unknown error'))
      }
    } finally {
      setSaving(false)
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
    setAutoSaved(false)  // Reset auto-save flag for new analysis

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
              } else if (message.type === 'result') {
                setAnalysis(prev => prev + message.content)
                setStatusMessage('Rendering analysis...')
                setAnalyzing(false)
                // Auto-save will be triggered after all messages are processed
              } else if (message.type === 'complete') {
                setAnalyzing(false)
                setStatusMessage('Analysis complete!')
              } else if (message.type === 'error') {
                setError(message.content || 'Analysis failed')
                setAnalyzing(false)
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

        {!analysis && !analyzing && (
          <div className="welcome-section">
            <div className="welcome-illustration">
              <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Simple coffee cup */}
                <path d="M35 40 L35 55 Q35 60 40 60 L55 60 Q60 60 60 55 L60 40 L35 40 Z"
                      stroke="#c77a4b" strokeWidth="1.5" fill="none" opacity="0.6"/>
                <path d="M60 45 Q63 45 63 48 Q63 51 60 51"
                      stroke="#c77a4b" strokeWidth="1.5" fill="none" opacity="0.6"/>
                {/* Steam lines */}
                <path d="M42 35 Q43 32 42 29" stroke="#d4a574" strokeWidth="1" opacity="0.4" fill="none"/>
                <path d="M48 35 Q47 32 48 29" stroke="#d4a574" strokeWidth="1" opacity="0.4" fill="none"/>
                <path d="M54 35 Q55 32 54 29" stroke="#d4a574" strokeWidth="1" opacity="0.4" fill="none"/>
                {/* Simple plant */}
                <line x1="80" y1="60" x2="80" y2="50" stroke="#738c5f" strokeWidth="1.5" opacity="0.5"/>
                <circle cx="80" cy="48" r="3" stroke="#738c5f" strokeWidth="1.5" fill="none" opacity="0.5"/>
                <circle cx="76" cy="45" r="2" stroke="#738c5f" strokeWidth="1.5" fill="none" opacity="0.5"/>
                <circle cx="84" cy="45" r="2" stroke="#738c5f" strokeWidth="1.5" fill="none" opacity="0.5"/>
              </svg>
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
                <span className="tip-text">Upload text or PDF</span>
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
                  <LogEntry key={i} log={log} />
                ))}
              </div>
            )}
          </div>
        )}

        {analysis && (
          <div className="results">
            <div className="results-actions">
              {autoSaved && (
                <span className="auto-saved-indicator">✅ Auto-saved</span>
              )}
              <button
                onClick={() => setShowSaveDialog(true)}
                className="save-button"
                title="Save analysis with custom title"
              >
                💾 {autoSaved ? 'Save Again' : 'Save'}
              </button>
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

      <footer className="footer">
        Interview Analyzer
      </footer>

      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Save Analysis</h3>
            <p>Give this analysis a title (optional):</p>
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder={file ? `${file.name} - ${new Date().toLocaleDateString()}` : 'Untitled Analysis'}
              className="save-title-input"
              autoFocus
            />
            <div className="modal-actions">
              <button
                onClick={() => {
                  setShowSaveDialog(false)
                  setSaveTitle('')
                }}
                className="cancel-button"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={() => saveAnalysis()}
                className="confirm-button"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
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
