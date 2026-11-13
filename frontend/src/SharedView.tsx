import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  fetchSharedAnalysis,
  subscribeToAuthState,
  signInWithGoogle,
  signOut,
  type SharedAnalysisErrorCode,
  type SharedAnalysisPayload,
  type User,
} from './api'
import { Toast, AnalysisMarkdown, Loading, ErrorBox, AnalysisHeader } from './components'
import { CopyIcon } from './icons'
import { useToast, useCopyToClipboard } from './hooks'
import './AnalysisView.css'

function GoogleLogoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

function getFirebaseAuthErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

interface SharedTopBarProps {
  authReady: boolean
  user: User | null
  authLoading: boolean
  onSignIn: () => void
  onSignOut: () => void
}

function SharedTopBar({ authReady, user, authLoading, onSignIn, onSignOut }: SharedTopBarProps) {
  return (
    <header className="shared-view-topbar">
      <div className="shared-topbar-left">
        <span className="shared-brand">Interview Analyzer</span>
        <span className="shared-badge">Shared Analysis</span>
      </div>
      {authReady && (
        <div className="shared-topbar-right">
          {user ? (
            <>
              {user.email && (
                <span className="shared-user-email" title={user.email}>
                  {user.email}
                </span>
              )}
              <button
                type="button"
                onClick={onSignIn}
                disabled={authLoading}
                className="shared-header-btn"
              >
                Switch account
              </button>
              <button
                type="button"
                onClick={onSignOut}
                disabled={authLoading}
                className="shared-header-btn"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              disabled={authLoading}
              className="shared-header-signin-btn"
            >
              <GoogleLogoIcon />
              <span>{authLoading ? 'Signing in...' : 'Sign in'}</span>
            </button>
          )}
        </div>
      )}
    </header>
  )
}

export function SharedView() {
  const { shareId } = useParams<{ shareId: string }>()
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [analysis, setAnalysis] = useState<SharedAnalysisPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<SharedAnalysisErrorCode | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authActionError, setAuthActionError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

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

    let cancelled = false

    const loadSharedAnalysis = async () => {
      setLoading(true)
      setError('')
      setErrorCode(null)

      if (!shareId) {
        setError('No share ID provided')
        setErrorCode('INVALID_ID')
        setAnalysis(null)
        setLoading(false)
        return
      }

      try {
        const idToken = user ? await user.getIdToken() : undefined
        const result = await fetchSharedAnalysis(shareId, idToken)
        if (cancelled) return

        if (result.ok) {
          setAnalysis(result.analysis)
          setErrorCode(null)
          setLoading(false)
          return
        }

        setAnalysis(null)
        setErrorCode(result.code)
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
      } catch (err: unknown) {
        if (cancelled) return
        console.error('Error loading shared analysis:', err)
        setAnalysis(null)
        setErrorCode('ERROR')
        setError('Failed to load shared analysis')
        setLoading(false)
      }
    }

    loadSharedAnalysis()
    return () => {
      cancelled = true
    }
  }, [shareId, user, authReady, reloadKey])

  const handleSignIn = async () => {
    setAuthActionError('')
    setAuthLoading(true)
    try {
      const signedInUser = await signInWithGoogle()
      setUser(signedInUser)
      setReloadKey((k) => k + 1)
    } catch (err: unknown) {
      const code = getFirebaseAuthErrorCode(err)
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return
      }
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        setAuthActionError(
          'Your browser blocked the sign-in popup. Please allow popups for this site (or open this link directly in Safari or Chrome) and try again.',
        )
        return
      }
      console.error('Google sign-in error on shared view:', err)
      setAuthActionError('Sign-in failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSignOut = async () => {
    setAuthActionError('')
    setAuthLoading(true)
    try {
      await signOut()
      setUser(null)
      setReloadKey((k) => k + 1)
    } catch (err: unknown) {
      console.error('Sign-out error on shared view:', err)
      setAuthActionError('Sign-out failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const copyToClipboard = () => {
    if (!analysis) return
    copyMarkdownContent('.markdown-body', analysis.analysis)
  }

  if (loading) {
    return (
      <div className="shared-view-container">
        <SharedTopBar
          authReady={authReady}
          user={user}
          authLoading={authLoading}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
        />
        <Loading message="Loading shared analysis..." />
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="shared-view-container">
        <SharedTopBar
          authReady={authReady}
          user={user}
          authLoading={authLoading}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
        />

        {errorCode === 'AUTH_REQUIRED' ? (
          <div className="shared-auth-card">
            <h2 className="shared-auth-title">Sign in to view shared analysis</h2>
            <p className="shared-auth-desc">
              The owner has shared this analysis with specific people. Sign in with the invited Google account to view it.
            </p>
            {authActionError && <div className="shared-auth-error">{authActionError}</div>}
            <div className="shared-auth-actions">
              <button
                type="button"
                onClick={handleSignIn}
                disabled={authLoading}
                className="shared-google-signin-btn"
              >
                <GoogleLogoIcon />
                <span>{authLoading ? 'Signing in...' : 'Sign in with Google'}</span>
              </button>
            </div>
          </div>
        ) : errorCode === 'FORBIDDEN' ? (
          <div className="shared-auth-card">
            <h2 className="shared-auth-title">Access restricted</h2>
            <p className="shared-auth-desc">
              {user?.email
                ? `You are signed in as ${user.email}, which does not have access to this shared analysis. Switch to the email address this link was shared with.`
                : 'Your current account does not have access to this shared analysis. Switch to the email address this link was shared with.'}
            </p>
            {authActionError && <div className="shared-auth-error">{authActionError}</div>}
            <div className="shared-auth-actions">
              <button
                type="button"
                onClick={handleSignIn}
                disabled={authLoading}
                className="shared-google-signin-btn"
              >
                <GoogleLogoIcon />
                <span>{authLoading ? 'Switching...' : 'Switch Google account'}</span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={authLoading}
                className="shared-secondary-btn"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <ErrorBox message={error || 'Analysis not found'} />
        )}
      </div>
    )
  }

  return (
    <div className="shared-view-container">
      <SharedTopBar
        authReady={authReady}
        user={user}
        authLoading={authLoading}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

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
