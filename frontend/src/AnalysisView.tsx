import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
  analysis: string
  title: string
  savedAt?: string
  createdAt: string
  updatedAt: string
}

export function AnalysisView() {
  const { analysisId } = useParams<{ analysisId: string }>()
  const navigate = useNavigate()
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

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
      alert('Copied to clipboard!')
    } else {
      navigator.clipboard.writeText(analysis.analysis)
      alert('Copied to clipboard!')
    }
  }

  const shareAnalysis = () => {
    const url = window.location.href
    navigator.clipboard.writeText(url)
    alert('Link copied to clipboard! You can share this with anyone.')
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
          <button onClick={shareAnalysis} className="share-button" title="Copy shareable link">
            🔗 Share
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
    </Layout>
  )
}
