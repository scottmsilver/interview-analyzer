import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getAnalysis, updateAnalysisSharing, sendShareEmails } from './api'
import { Toast, AnalysisMarkdown, Loading, ErrorBox, AnalysisHeader } from './components'
import { CopyIcon, TranscriptIcon, ShareIcon, LinkIcon } from './icons'
import { useToast, useCopyToClipboard } from './hooks'
import { type AnalysisData } from './types'
import { useAuth } from './App'
import './AnalysisView.css'

const SIMPLE_EMAIL_REGEX = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/

function parseEmailList(raw: string): { valid: string[]; invalid: string[] } {
  const tokens = raw
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  const valid: string[] = []
  const invalid: string[] = []
  const seenValid = new Set<string>()
  const seenInvalid = new Set<string>()

  for (const token of tokens) {
    if (SIMPLE_EMAIL_REGEX.test(token)) {
      if (!seenValid.has(token)) {
        seenValid.add(token)
        valid.push(token)
      }
    } else if (!seenInvalid.has(token)) {
      seenInvalid.add(token)
      invalid.push(token)
    }
  }

  return { valid, invalid }
}

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
  const [anyoneEmails, setAnyoneEmails] = useState('')
  const [previouslySharedEmails, setPreviouslySharedEmails] = useState<string[]>([])
  const [sendEmailOnSave, setSendEmailOnSave] = useState(true)
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

  const ownerEmail = user.email?.trim().toLowerCase() || ''

  const mergeOwnerEmail = (emails: string[]) =>
    Array.from(new Set([...(ownerEmail ? [ownerEmail] : []), ...emails]))

  const parsedSpecific = parseEmailList(sharedEmails)
  const parsedAnyone = parseEmailList(anyoneEmails)
  const previousRecipientSet = new Set(previouslySharedEmails)
  const newSpecificRecipients = parsedSpecific.valid.filter((e) => !previousRecipientSet.has(e))
  const recipientsToEmail =
    shareMode === 'anyone'
      ? parsedAnyone.valid
      : shareMode === 'specific' && sendEmailOnSave
        ? (newSpecificRecipients.length > 0 ? newSpecificRecipients : parsedSpecific.valid)
        : []

  const selectShareMode = (mode: 'private' | 'anyone' | 'specific') => {
    setShareMode(mode)
    if (mode === 'specific') {
      setSendEmailOnSave(previouslySharedEmails.length === 0 || newSpecificRecipients.length > 0)
    }
  }

  const handleSharedEmailsChange = (value: string) => {
    const nextNew = parseEmailList(value).valid.filter((e) => !previousRecipientSet.has(e))
    setSharedEmails(value)
    if (nextNew.length > 0 && newSpecificRecipients.length === 0) {
      setSendEmailOnSave(true)
    } else if (nextNew.length === 0 && newSpecificRecipients.length > 0 && previouslySharedEmails.length > 0) {
      setSendEmailOnSave(false)
    }
  }

  const openShareModal = () => {
    if (analysis) {
      const mode = analysis.shareMode || 'private'
      setShareMode(mode)
      const existing = (analysis.sharedWith || []).map(e => e.trim().toLowerCase()).filter(Boolean)
      const existingRecipients = existing.filter(e => e !== ownerEmail)
      setPreviouslySharedEmails(existingRecipients)
      setSharedEmails(mode === 'specific' ? existingRecipients.join(', ') : '')
      setAnyoneEmails('')
      setSendEmailOnSave(mode !== 'specific' || existingRecipients.length === 0)
    }
    setShowShareModal(true)
  }

  const saveShareSettings = async () => {
    if (!analysisId || !analysis) return

    if (shareMode === 'specific') {
      if (parsedSpecific.invalid.length > 0) {
        showToast(`× Invalid email: ${parsedSpecific.invalid[0]}`)
        return
      }
      if (parsedSpecific.valid.length === 0) {
        showToast('× Enter at least one email address')
        return
      }
    } else if (shareMode === 'anyone' && parsedAnyone.invalid.length > 0) {
      showToast(`× Invalid email: ${parsedAnyone.invalid[0]}`)
      return
    }

    const toSend = recipientsToEmail
    if (shareMode !== 'private' && analysis.shareId) {
      const shareUrl = `${window.location.origin}/shared/${analysis.shareId}`
      navigator.clipboard?.writeText(shareUrl).catch(() => {})
    }

    setSavingShare(true)
    try {
      const emails = shareMode === 'specific' ? mergeOwnerEmail(parsedSpecific.valid) : []

      await updateAnalysisSharing(analysisId, shareMode, emails)

      // Update local state
      setAnalysis({
        ...analysis,
        shareMode,
        sharedWith: emails
      })

      if (toSend.length > 0) {
        try {
          const emailRes = await sendShareEmails(analysisId, toSend)
          if (emailRes.sent.length > 0 && emailRes.failed.length === 0) {
            showToast(
              `Link copied & emailed to ${emailRes.sent.length === 1 ? emailRes.sent[0] : `${emailRes.sent.length} people`}`
            )
          } else if (emailRes.sent.length > 0) {
            showToast(`Saved; emailed ${emailRes.sent.length}, failed for ${emailRes.failed[0].email}`)
          } else {
            showToast(`Sharing saved, but email failed: ${emailRes.failed[0]?.error || 'Unknown error'}`)
          }
        } catch (emailErr) {
          console.error('Error sending share email:', emailErr)
          showToast(
            `Sharing saved, but email failed: ${emailErr instanceof Error ? emailErr.message : 'Unknown error'}`
          )
        }
      } else if (shareMode !== 'private' && analysis.shareId) {
        showToast('✓ Link copied to clipboard')
      } else {
        showToast('✓ Sharing updated')
      }

      setShowShareModal(false)
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
                  onClick={() => selectShareMode('private')}
                >
                  <input
                    type="radio"
                    name="shareMode"
                    checked={shareMode === 'private'}
                    onChange={() => selectShareMode('private')}
                  />
                  <div className="share-option-content">
                    <div className="share-option-label">Private</div>
                    <div className="share-option-desc">Only you can view this analysis</div>
                  </div>
                </label>
                <div
                  className={`share-option ${shareMode === 'anyone' ? 'selected' : ''}`}
                  onClick={() => selectShareMode('anyone')}
                >
                  <input
                    type="radio"
                    name="shareMode"
                    checked={shareMode === 'anyone'}
                    onChange={() => selectShareMode('anyone')}
                  />
                  <div className="share-option-content">
                    <div className="share-option-label">Anyone with link</div>
                    <div className="share-option-desc">Anyone with the link can view</div>
                    {shareMode === 'anyone' && (
                      <div className="share-emails-input" onClick={(e) => e.stopPropagation()}>
                        <span className="share-emails-label">Email link to (optional)</span>
                        <input
                          type="text"
                          placeholder="colleague@example.com, coach@example.com"
                          value={anyoneEmails}
                          onChange={(e) => setAnyoneEmails(e.target.value)}
                        />
                        <div className="share-emails-hint">
                          Optional — separate multiple emails with commas to send the link now
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className={`share-option ${shareMode === 'specific' ? 'selected' : ''}`}
                  onClick={() => selectShareMode('specific')}
                >
                  <input
                    type="radio"
                    name="shareMode"
                    checked={shareMode === 'specific'}
                    onChange={() => selectShareMode('specific')}
                  />
                  <div className="share-option-content">
                    <div className="share-option-label">Specific people</div>
                    <div className="share-option-desc">Only specific email addresses can view</div>
                    {shareMode === 'specific' && (
                      <div className="share-emails-input" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          placeholder="colleague@example.com, coach@example.com"
                          value={sharedEmails}
                          onChange={(e) => handleSharedEmailsChange(e.target.value)}
                        />
                        <div className="share-emails-hint">
                          Separate multiple emails with commas{ownerEmail ? ` (your email ${ownerEmail} is always included)` : ''}
                        </div>
                        <label className="share-email-toggle">
                          <input
                            type="checkbox"
                            checked={sendEmailOnSave}
                            onChange={(e) => setSendEmailOnSave(e.target.checked)}
                          />
                          <span>
                            {previouslySharedEmails.length > 0 && newSpecificRecipients.length === 0
                              ? 'Re-send shared link email to all recipients'
                              : newSpecificRecipients.length > 0 && previouslySharedEmails.length > 0
                                ? 'Email shared link to new recipients'
                                : 'Email shared link to recipients'}
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
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
                {savingShare
                  ? (recipientsToEmail.length > 0 ? 'Sending...' : 'Saving...')
                  : (recipientsToEmail.length > 0 ? 'Save & Send Email' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
