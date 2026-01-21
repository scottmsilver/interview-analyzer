import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { getInterviewTypeLabel, formatDateTime, getErrorMessage } from './types'
import { fetchLogs, type LogEntry, type FetchLogsParams } from './api'

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

// =============================================================================
// LogViewer Component
// =============================================================================

type SeverityFilter = 'ALL' | 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
type TimeRange = 1 | 6 | 24 | 72 | 168

interface LogViewerProps {
  defaultHoursAgo?: TimeRange
  defaultLimit?: number
  autoRefresh?: boolean
  autoRefreshInterval?: number
}

export function LogViewer({
  defaultHoursAgo = 24,
  defaultLimit = 100,
  autoRefresh = false,
  autoRefreshInterval = 30000,
}: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)

  // Filter state
  const [severity, setSeverity] = useState<SeverityFilter>('ALL')
  const [hoursAgo, setHoursAgo] = useState<TimeRange>(defaultHoursAgo)
  const [limit, setLimit] = useState(defaultLimit)
  const [searchQuery, setSearchQuery] = useState('')
  const [hideAuditLogs, setHideAuditLogs] = useState(true)

  const loadLogs = useCallback(async () => {
    setError(null)
    setLoading(true)

    try {
      const params: FetchLogsParams = {
        limit,
        hoursAgo,
      }
      if (severity !== 'ALL') {
        params.severity = severity
      }

      const response = await fetchLogs(params)
      setLogs(response.logs)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [severity, hoursAgo, limit])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(loadLogs, autoRefreshInterval)
    return () => clearInterval(interval)
  }, [autoRefresh, autoRefreshInterval, loadLogs])

  const getSeverityClass = (sev: string) => {
    switch (sev.toUpperCase()) {
      case 'ERROR': return 'log-severity-error'
      case 'WARNING': return 'log-severity-warning'
      case 'INFO': return 'log-severity-info'
      case 'DEBUG': return 'log-severity-debug'
      default: return 'log-severity-default'
    }
  }

  const formatLogTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatFullTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString()
  }

  // Filter logs by search query and audit log toggle
  const filteredLogs = logs.filter(log => {
    // Filter out audit logs if enabled
    if (hideAuditLogs && log.message.includes('AuditLog')) {
      return false
    }
    // Filter by search query
    if (searchQuery) {
      return log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
             log.functionName.toLowerCase().includes(searchQuery.toLowerCase())
    }
    return true
  })

  const timeRangeOptions: { value: TimeRange; label: string }[] = [
    { value: 1, label: '1 hour' },
    { value: 6, label: '6 hours' },
    { value: 24, label: '24 hours' },
    { value: 72, label: '3 days' },
    { value: 168, label: '7 days' },
  ]

  return (
    <div className="log-viewer">
      {/* Filters */}
      <div className="log-filters">
        <div className="log-filter-group">
          <label>Severity</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
            className="log-filter-select"
          >
            <option value="ALL">All</option>
            <option value="ERROR">Error</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
            <option value="DEBUG">Debug</option>
          </select>
        </div>

        <div className="log-filter-group">
          <label>Time Range</label>
          <select
            value={hoursAgo}
            onChange={(e) => setHoursAgo(Number(e.target.value) as TimeRange)}
            className="log-filter-select"
          >
            {timeRangeOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="log-filter-group">
          <label>Limit</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="log-filter-select"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
        </div>

        <div className="log-filter-group log-filter-search">
          <label>Search</label>
          <input
            type="text"
            placeholder="Filter logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="log-search-input"
          />
        </div>

        <div className="log-filter-group log-filter-checkbox">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hideAuditLogs}
              onChange={(e) => setHideAuditLogs(e.target.checked)}
            />
            Hide Audit Logs
          </label>
        </div>

        <button
          className="log-refresh-button"
          onClick={loadLogs}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="log-error">
          <strong>Error loading logs:</strong> {error}
        </div>
      )}

      {/* Log entries table */}
      <div className="log-table-wrapper">
        {loading && logs.length === 0 ? (
          <div className="log-loading">Loading logs...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="log-empty">
            {searchQuery ? 'No logs match your search.' : 'No logs found for the selected time range.'}
          </div>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Severity</th>
                <th>Function</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, index) => (
                <tr
                  key={`${log.timestamp}-${index}`}
                  className={`${getSeverityClass(log.severity)} ${selectedLog === log ? 'selected' : ''}`}
                  onClick={() => setSelectedLog(selectedLog === log ? null : log)}
                >
                  <td className="log-time" title={formatFullTime(log.timestamp)}>
                    {formatLogTime(log.timestamp)}
                  </td>
                  <td className={`log-severity ${getSeverityClass(log.severity)}`}>
                    {log.severity}
                  </td>
                  <td className="log-function">{log.functionName}</td>
                  <td className="log-message">
                    {log.message.length > 300 && selectedLog !== log
                      ? log.message.substring(0, 300) + '...'
                      : log.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
