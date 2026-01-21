import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getAnalysis, updateAnalysisSharing } from './api'
import { Toast, AnalysisMarkdown, Loading, ErrorBox, AnalysisHeader } from './components'
import { CopyIcon, TranscriptIcon, ShareIcon, LinkIcon } from './icons'
import { useToast, useCopyToClipboard } from './hooks'
import { type AnalysisData } from './types'
import { useAuth } from './App'
import './AnalysisView.css'

export function AnalysisView() {
  const { user } = useAuth()
  const { analysisId } = useParams<{ analysisId: string }>()
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareMode, setShareMode] = useState<'private' | 'anyone' | 'specific'>('private')
  const [sharedEmails, setSharedEmails] = useState('')
  const [savingShare, setSavingShare] = useState(false)

  const { toastMessage, showToast } = useToast()
  const { copyMarkdownContent, copyText } = useCopyToClipboard(showToast)

  useEffect(() => {
    const loadAnalysis = async () => {
      if (!analysisId) {
        setError('No analysis ID provided')
        setLoading(false)
        return
      }

      try {
        const data = await getAnalysis(analysisId)
        if (!data) {
          setError('Analysis not found')
          setLoading(false)
          return
        }

        setAnalysis(data)
        setLoading(false)
      } catch (err) {
        console.error('Error loading analysis:', err)
        setError('Failed to load analysis')
        setLoading(false)
      }
    }

    loadAnalysis()
  }, [analysisId])

  const copyToClipboard = () => {
    if (!analysis) return
    copyMarkdownContent('.markdown-body', analysis.analysis)
  }

  const openShareModal = () => {
    if (analysis) {
      setShareMode(analysis.shareMode || 'private')
      setSharedEmails((analysis.sharedWith || []).join(', '))
    }
    setShowShareModal(true)
  }

  const saveShareSettings = async () => {
    if (!analysisId || !analysis) return

    setSavingShare(true)
    try {
      const emails = shareMode === 'specific'
        ? sharedEmails.split(',').map(e => e.trim().toLowerCase()).filter(e => e.includes('@'))
        : []

      await updateAnalysisSharing(analysisId, shareMode, emails)

      // Update local state
      setAnalysis({
        ...analysis,
        shareMode,
        sharedWith: emails
      })

      setShowShareModal(false)

      // Auto-copy link to clipboard for shareable modes
      if (shareMode !== 'private' && analysis.shareId) {
        const shareUrl = `${window.location.origin}/shared/${analysis.shareId}`
        navigator.clipboard.writeText(shareUrl)
        showToast('✓ Link copied to clipboard')
      } else {
        showToast('✓ Sharing updated')
      }
    } catch (err) {
      console.error('Error saving share settings:', err)
      showToast('× Failed to save')
    } finally {
      setSavingShare(false)
    }
  }

  const copyShareLink = () => {
    if (!analysis?.shareId) return
    const shareUrl = `${window.location.origin}/shared/${analysis.shareId}`
    copyText(shareUrl, '✓ Link copied')
  }

  const isOwner = user.uid === analysis?.userId

  if (loading) {
    return <Loading message="Loading analysis..." />
  }

  if (error || !analysis) {
    return <ErrorBox message={error || 'Analysis not found'} />
  }

  return (
    <>
      <AnalysisHeader
        title={analysis.title}
        interviewType={analysis.interviewType}
        fileName={analysis.transcriptFileName}
        savedAt={analysis.savedAt}
        createdAt={analysis.createdAt}
      />

      <div className="results">
        <div className="results-actions">
          {analysis.transcriptContent && (
            <button onClick={() => setShowTranscript(true)} className="transcript-button" title="View transcript">
              <TranscriptIcon />
              <span className="button-text">Transcript</span>
            </button>
          )}
          {isOwner && (
            <button onClick={openShareModal} className="share-button" title="Share settings">
              <ShareIcon />
            </button>
          )}
          <button onClick={copyToClipboard} className="copy-button" title="Copy to clipboard">
            <CopyIcon />
          </button>
        </div>

        <AnalysisMarkdown content={analysis.analysis} />
      </div>

      <Toast message={toastMessage} />

      {/* Transcript Dialog */}
      {showTranscript && analysis.transcriptContent && (
        <div className="transcript-overlay" onClick={() => setShowTranscript(false)}>
          <div className="transcript-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="transcript-header">
              <h3>Interview Transcript</h3>
              <div className="transcript-actions">
                <button
                  onClick={() => copyText(analysis.transcriptContent || '', '✓ Transcript copied')}
                  className="transcript-copy-btn"
                  title="Copy transcript"
                >
                  <CopyIcon />
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

      {/* Share Modal */}
      {showShareModal && (
        <div className="share-overlay" onClick={() => setShowShareModal(false)}>
          <div className="share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="share-modal-header">
              <h3>Share Settings</h3>
              <button className="share-close-btn" onClick={() => setShowShareModal(false)}>×</button>
            </div>
            <div className="share-modal-body">
              <div className="share-options">
                <label
                  className={`share-option ${shareMode === 'private' ? 'selected' : ''}`}
                  onClick={() => setShareMode('private')}
                >
                  <input
                    type="radio"
                    name="shareMode"
                    checked={shareMode === 'private'}
                    onChange={() => setShareMode('private')}
                  />
                  <div className="share-option-content">
                    <div className="share-option-label">Private</div>
                    <div className="share-option-desc">Only you can view this analysis</div>
                  </div>
                </label>
                <label
                  className={`share-option ${shareMode === 'anyone' ? 'selected' : ''}`}
                  onClick={() => setShareMode('anyone')}
                >
                  <input
                    type="radio"
                    name="shareMode"
                    checked={shareMode === 'anyone'}
                    onChange={() => setShareMode('anyone')}
                  />
                  <div className="share-option-content">
                    <div className="share-option-label">Anyone with link</div>
                    <div className="share-option-desc">Anyone with the link can view</div>
                  </div>
                </label>
                <label
                  className={`share-option ${shareMode === 'specific' ? 'selected' : ''}`}
                  onClick={() => setShareMode('specific')}
                >
                  <input
                    type="radio"
                    name="shareMode"
                    checked={shareMode === 'specific'}
                    onChange={() => setShareMode('specific')}
                  />
                  <div className="share-option-content">
                    <div className="share-option-label">Specific people</div>
                    <div className="share-option-desc">Only specific email addresses can view</div>
                    {shareMode === 'specific' && (
                      <div className="share-emails-input">
                        <input
                          type="text"
                          placeholder="email1@gmail.com, email2@gmail.com"
                          value={sharedEmails}
                          onChange={(e) => setSharedEmails(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="share-emails-hint">Separate multiple emails with commas</div>
                      </div>
                    )}
                  </div>
                </label>
              </div>

              {shareMode !== 'private' && analysis?.shareId && (
                <div className="share-link-section">
                  <div className="share-link-label">Share link</div>
                  <div className="share-link-row">
                    <input
                      type="text"
                      className="share-link-input"
                      value={`${window.location.origin}/shared/${analysis.shareId}`}
                      readOnly
                    />
                    <button className="share-copy-btn" onClick={copyShareLink} title="Copy link">
                      <LinkIcon size={14} />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="share-modal-footer">
              <button className="share-cancel-btn" onClick={() => setShowShareModal(false)}>Cancel</button>
              <button
                className="share-save-btn"
                onClick={saveShareSettings}
                disabled={savingShare}
              >
                {savingShare ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
