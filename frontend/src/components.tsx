import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { getInterviewTypeLabel, formatDateTime } from './types'

interface ToastProps {
  message: string
}

export function Toast({ message }: ToastProps) {
  if (!message) return null
  return (
    <div className="toast-notification">
      {message}
    </div>
  )
}

interface LoadingProps {
  message?: string
}

export function Loading({ message = 'Loading...' }: LoadingProps) {
  return <div className="loading">{message}</div>
}

interface ErrorBoxProps {
  message: string
}

export function ErrorBox({ message }: ErrorBoxProps) {
  return <div className="error-box">{message}</div>
}

interface AnalysisHeaderProps {
  title: string
  interviewType: string
  fileName: string
  savedAt?: string
  createdAt?: string
  showDate?: boolean
}

export function AnalysisHeader({
  title,
  interviewType,
  fileName,
  savedAt,
  createdAt,
  showDate = true
}: AnalysisHeaderProps) {
  return (
    <div className="analysis-view-header">
      <div className="analysis-meta">
        <h1 className="analysis-view-title">{title}</h1>
        <span className="interview-type-badge">{getInterviewTypeLabel(interviewType)}</span>
        <span className="analysis-view-separator">•</span>
        <span className="analysis-view-filename">{fileName}</span>
        {showDate && (savedAt || createdAt) && (
          <>
            <span className="analysis-view-separator">•</span>
            <span className="analysis-view-date">
              {savedAt || (createdAt ? formatDateTime(createdAt) : '')}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

interface AnalysisMarkdownProps {
  content: string
}

export function AnalysisMarkdown({ content }: AnalysisMarkdownProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
