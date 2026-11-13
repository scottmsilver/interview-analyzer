import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { fetchSharedAnalysis, subscribeToAuthState, type SharedAnalysisPayload, type User } from './api'
import { Toast, AnalysisMarkdown, Loading, ErrorBox, AnalysisHeader } from './components'
import { CopyIcon } from './icons'
import { useToast, useCopyToClipboard } from './hooks'
import './AnalysisView.css'

export function SharedView() {
  const { shareId } = useParams<{ shareId: string }>()
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [analysis, setAnalysis] = useState<SharedAnalysisPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const { toastMessage, showToast } = useToast()
  const { copyMarkdownContent } = useCopyToClipboard(showToast)

  // Listen for auth state - only fires once auth is initialized
  useEffect(() => {
    const unsubscribe = subscribeToAuthState((currentUser) => {
      setUser(currentUser)
      setAuthReady(true)
    })
    return () => unsubscribe()
  }, [])

  // Load analysis once auth is ready
  useEffect(() => {
    if (!authReady) return

    const loadSharedAnalysis = async () => {
      setLoading(true)
      setError('')

      if (!shareId) {
        setError('No share ID provided')
        setLoading(false)
        return
      }

      try {
        const idToken = user ? await user.getIdToken() : undefined
        const result = await fetchSharedAnalysis(shareId, idToken)

        if (result.ok) {
          setAnalysis(result.analysis)
          setLoading(false)
          return
        }

        if (result.code === 'NOT_FOUND') {
          setError('Shared analysis not found')
        } else if (result.code === 'PRIVATE') {
          setError('This analysis is not shared')
        } else if (result.code === 'AUTH_REQUIRED') {
          setError('Please sign in to view this shared analysis')
        } else if (result.code === 'FORBIDDEN') {
          setError('You do not have permission to view this analysis')
        } else {
          setError(result.error || 'Failed to load shared analysis')
        }
        setLoading(false)
      } catch (err) {
        console.error('Error loading shared analysis:', err)
        setError('Failed to load shared analysis')
        setLoading(false)
      }
    }

    loadSharedAnalysis()
  }, [shareId, user, authReady])

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
