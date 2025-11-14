import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { db, auth } from './firebase'
import { doc, getDoc } from 'firebase/firestore'
import { Layout } from './Layout'
import './AnalysisView.css'

interface AnalysisData {
  userId: string
  interviewType: string
  transcriptFileName: string
  transcriptContent?: string
  analysis: string
  title: string
  savedAt?: string
  createdAt: string
  updatedAt: string
}

export function AnalysisView() {
  const { analysisId } = useParams<{ analysisId: string }>()
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)

  useEffect(() => {
    const loadAnalysis = async () => {
      if (!analysisId) {
        setError('No analysis ID provided')
        setLoading(false)
        return
      }

      try {
        const docRef = doc(db, 'analyses', analysisId)
        const docSnap = await getDoc(docRef)

        if (!docSnap.exists()) {
          setError('Analysis not found')
          setLoading(false)
          return
        }

        setAnalysis(docSnap.data() as AnalysisData)
        setLoading(false)
      } catch (err) {
        console.error('Error loading analysis:', err)
        setError('Failed to load analysis')
        setLoading(false)
      }
    }

    // Check if user is admin
    const checkAdmin = async () => {
      const user = auth.currentUser
      if (!user) return

      try {
        const adminRef = doc(db, 'admins', user.uid)
        const adminSnap = await getDoc(adminRef)
        setIsAdmin(adminSnap.exists())
      } catch (err) {
        console.error('Error checking admin status:', err)
      }
    }

    loadAnalysis()
    checkAdmin()
  }, [analysisId])

  // Auto-dismiss toast quickly (1.5 seconds)
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage('')
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  const showToast = (message: string) => {
    setToastMessage(message)
  }

  const copyToClipboard = () => {
    if (!analysis) return

    const markdownBody = document.querySelector('.markdown-body')
    if (markdownBody) {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(markdownBody)
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.execCommand('copy')
      selection?.removeAllRanges()
      showToast('✓ Copied')
    } else {
      navigator.clipboard.writeText(analysis.analysis)
      showToast('✓ Copied')
    }
  }

  const shareAnalysis = () => {
    const url = window.location.href
    navigator.clipboard.writeText(url)
    showToast('✓ Link copied')
  }

  if (loading) {
    return (
      <Layout user={auth.currentUser} isAdmin={isAdmin} currentView="analysis">
        <div className="loading">Loading analysis...</div>
      </Layout>
    )
  }

  if (error || !analysis) {
    return (
      <Layout user={auth.currentUser} isAdmin={isAdmin} currentView="analysis">
        <div className="error-box">{error || 'Analysis not found'}</div>
      </Layout>
    )
  }

  const getInterviewTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      'google-apm': 'Google APM',
      'meta-pm': 'Meta PM',
      'amazon-pm': 'Amazon PM',
      'generic': 'Generic PM'
    }
    return types[type] || type
  }

  return (
    <Layout user={auth.currentUser} isAdmin={isAdmin} currentView="analysis">
      <div className="analysis-view-header">
        <div className="analysis-meta">
          <h1 className="analysis-view-title">{analysis.title}</h1>
          <span className="interview-type-badge">{getInterviewTypeLabel(analysis.interviewType)}</span>
          <span className="analysis-view-separator">•</span>
          <span className="analysis-view-filename">{analysis.transcriptFileName}</span>
          <span className="analysis-view-separator">•</span>
          <span className="analysis-view-date">
            {analysis.savedAt || `${new Date(analysis.createdAt).toLocaleDateString()} at ${new Date(analysis.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      </div>

      <div className="results">
        <div className="results-actions">
          {analysis.transcriptContent && (
            <button onClick={() => setShowTranscript(true)} className="transcript-button" title="View transcript">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2H13C13.5523 2 14 2.44772 14 3V13C14 13.5523 13.5523 14 13 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5 5H11M5 8H11M5 11H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="button-text">Transcript</span>
            </button>
          )}
          <button onClick={shareAnalysis} className="share-button" title="Copy shareable link">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 8.5L9.5 11.5M6.5 8.5L9.5 5.5M6.5 8.5H2C1.44772 8.5 1 8.05228 1 7.5V3C1 2.44772 1.44772 2 2 2H5.5C6.05228 2 6.5 2.44772 6.5 3V5.5M9.5 11.5C9.5 12.8807 10.6193 14 12 14C13.3807 14 14.5 12.8807 14.5 11.5C14.5 10.1193 13.3807 9 12 9C10.6193 9 9.5 10.1193 9.5 11.5ZM9.5 5.5C9.5 6.88071 10.6193 8 12 8C13.3807 8 14.5 6.88071 14.5 5.5C14.5 4.11929 13.3807 3 12 3C10.6193 3 9.5 4.11929 9.5 5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={copyToClipboard} className="copy-button" title="Copy to clipboard">
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
            {analysis.analysis}
          </ReactMarkdown>
        </div>
      </div>

      <footer className="footer">
        Interview Analyzer
      </footer>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-notification">
          {toastMessage}
        </div>
      )}

      {/* Transcript Dialog */}
      {showTranscript && analysis.transcriptContent && (
        <div className="transcript-overlay" onClick={() => setShowTranscript(false)}>
          <div className="transcript-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="transcript-header">
              <h3>Interview Transcript</h3>
              <div className="transcript-actions">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(analysis.transcriptContent || '')
                    showToast('✓ Transcript copied')
                  }}
                  className="transcript-copy-btn"
                  title="Copy transcript"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.75 4.75H10.25V1.75H5.75V4.75ZM4.5 1.5C4.5 0.947715 4.94772 0.5 5.5 0.5H10.5C11.0523 0.5 11.5 0.947715 11.5 1.5V5C11.5 5.55228 11.0523 6 10.5 6H5.5C4.94772 6 4.5 5.55228 4.5 5V1.5Z" fill="currentColor"/>
                    <path d="M2.5 4.5C1.94772 4.5 1.5 4.94772 1.5 5.5V14C1.5 14.5523 1.94772 15 2.5 15H11C11.5523 15 12 14.5523 12 14V13H13.5V14C13.5 15.3807 12.3807 16.5 11 16.5H2.5C1.11929 16.5 0 15.3807 0 14V5.5C0 4.11929 1.11929 3 2.5 3H4V4.5H2.5Z" fill="currentColor" transform="translate(0.5, -0.5)"/>
                  </svg>
                </button>
                <button
                  onClick={() => setShowTranscript(false)}
                  className="transcript-close-btn"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="transcript-content">
              <pre>{analysis.transcriptContent}</pre>
            </div>
            <div className="transcript-footer">
              <span className="transcript-info">
                {analysis.transcriptFileName} • {analysis.transcriptContent.length.toLocaleString()} characters
              </span>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
