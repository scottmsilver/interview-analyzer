import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getAnalysisByShareId, subscribeToAuthState, type User } from './api'
import { Toast, AnalysisMarkdown, Loading, ErrorBox, AnalysisHeader } from './components'
import { CopyIcon } from './icons'
import { useToast, useCopyToClipboard } from './hooks'
import { type AnalysisData } from './types'
import './AnalysisView.css'

export function SharedView() {
  const { shareId } = useParams<{ shareId: string }>()
  const [user, setUser] = useState<User | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const { toastMessage, showToast } = useToast()
  const { copyMarkdownContent } = useCopyToClipboard(showToast)

  // Listen for auth state
  useEffect(() => {
    const unsubscribe = subscribeToAuthState((currentUser) => {
      setUser(currentUser)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const loadSharedAnalysis = async () => {
      if (!shareId) {
        setError('No share ID provided')
        setLoading(false)
        return
      }

      try {
        const data = await getAnalysisByShareId(shareId)

        if (!data) {
          setError('Shared analysis not found')
          setLoading(false)
          return
        }

        // Check sharing permissions
        if (data.shareMode === 'private') {
          setError('This analysis is not shared')
          setLoading(false)
          return
        }

        if (data.shareMode === 'specific') {
          // Need to check if current user's email is in sharedWith
          if (!user) {
            setError('Please sign in to view this shared analysis')
            setLoading(false)
            return
          }
          if (!(data.sharedWith || []).includes(user.email || '')) {
            setError('You do not have permission to view this analysis')
            setLoading(false)
            return
          }
        }

        // shareMode === 'anyone' or user is in sharedWith list
        setAnalysis(data)
        setLoading(false)
      } catch (err) {
        console.error('Error loading shared analysis:', err)
        setError('Failed to load shared analysis')
        setLoading(false)
      }
    }

    // Wait a moment for auth to initialize
    const timer = setTimeout(() => {
      loadSharedAnalysis()
    }, 500)

    return () => clearTimeout(timer)
  }, [shareId, user])

  const copyToClipboard = () => {
    if (!analysis) return
    copyMarkdownContent('.markdown-body', analysis.analysis)
  }

  if (loading) {
    return (
      <div className="shared-view-container">
        <div className="shared-view-header">
          <h1>Shared Analysis</h1>
        </div>
        <Loading message="Loading shared analysis..." />
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="shared-view-container">
        <div className="shared-view-header">
          <h1>Shared Analysis</h1>
        </div>
        <ErrorBox message={error || 'Analysis not found'} />
        {error === 'Please sign in to view this shared analysis' && (
          <p style={{ textAlign: 'center', marginTop: '1rem', color: '#666' }}>
            The owner has restricted this analysis to specific people.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="shared-view-container">
      <div className="shared-view-header">
        <div className="shared-badge">Shared Analysis</div>
      </div>

      <AnalysisHeader
        title={analysis.title}
        interviewType={analysis.interviewType}
        fileName={analysis.transcriptFileName}
        showDate={false}
      />

      <div className="results">
        <div className="results-actions">
          <button onClick={copyToClipboard} className="copy-button" title="Copy to clipboard">
            <CopyIcon />
          </button>
        </div>

        <AnalysisMarkdown content={analysis.analysis} />
      </div>

      <Toast message={toastMessage} />
    </div>
  )
}
