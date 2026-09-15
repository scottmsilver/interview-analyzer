import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { getInterviewTypeLabel, formatDateTime, getErrorMessage } from './types'
import { fetchLogs, type LogEntry, type FetchLogsParams } from './api'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import './ActivityLog.css'

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

interface LogMarkdownProps {
  content: string
}

/**
 * Compact markdown for activity-log lines.
 *
 * Agent output is markdown, so log lines were showing raw backticks, asterisks
 * and list markers. This renders them, without the syntax highlighting or
 * document spacing the full analysis view uses.
 */
export function LogMarkdown({ content }: LogMarkdownProps) {
  return (
    <div className="log-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

// =============================================================================
// ActivityLog Component
// =============================================================================

export interface ActivityEntry {
  content: string
  raw: any
  at: number
}

type LogKind = 'agent' | 'tool' | 'result' | 'thinking' | 'system' | 'error'

const LOG_KIND_LABEL: Record<LogKind, string> = {
  agent: 'Agent',
  tool: 'Tool',
  result: 'Result',
  thinking: 'Thinking',
  system: 'System',
  error: 'Error',
}

/**
 * Classify a line from the structured message rather than by searching its
 * text. Sniffing for words like "tool" in free-form content misfiled entries
 * whenever the model happened to use the word.
 */
function classifyLog(raw: any, content: string): LogKind {
  const t = raw?.type
  if (t === 'tool_use' || t === 'tool_result') return 'tool'
  if (t === 'thinking' || t === 'thinking_delta' || t === 'thinking_summary') return 'thinking'
  if (t === 'result') return 'result'
  if (t === 'error') return 'error'
  if (t === 'text' || t === 'assistant') return 'agent'
  if (/^\[(system|stream_event)/i.test(content)) return 'system'
  return 'agent'
}

/**
 * Reduce a message to one scannable line. Raw SDK envelopes arrive as
 * bracketed tags such as "[stream_event]", which carry nothing on their own.
 */
function summarizeLog(raw: any, content: string): string {
  if (raw?.type === 'tool_use') {
    const tool = raw.tool || raw.name || 'tool'
    const input = raw.input || {}
    const arg = input.query ?? input.description ?? Object.values(input)[0]
    return '`' + tool + '(' + (arg ? JSON.stringify(arg).slice(0, 60) : '') + ')`'
  }
  if (raw?.type === 'tool_result') {
    const body = String(raw.content ?? raw.result ?? '').trim()
    return body ? body.slice(0, 400) : '_(empty result)_'
  }
  if (raw?.type === 'text' && raw.text) return String(raw.text)
  if (raw?.type === 'thinking_delta' && raw.snippet) return String(raw.snippet)
  const stripped = content.replace(/^\[[^\]]+\]\s*/, '').trim()
  return stripped || content
}

function elapsed(at: number, startedAt: number | null): string {
  if (!startedAt) return new Date(at).toLocaleTimeString('en-US', { hour12: false })
  const secs = Math.max(0, Math.round((at - startedAt) / 1000))
  return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0')
}

const activityColumn = createColumnHelper<ActivityEntry>()

interface ActivityLogProps {
  entries: ActivityEntry[]
  startedAt: number | null
}

/**
 * Live activity log for a running analysis.
 *
 * Built on the same @tanstack/react-table used by History and Admin, and
 * styled to match the admin log viewer, so the two logs read as one system.
 * Replaces an emoji chat-bubble view whose messages alternated left and right,
 * which made a time-ordered sequence hard to follow.
 *
 * This is deliberately separate from LogViewer: that one queries stored
 * server-side logs with severity and time filters, while these entries arrive
 * over the analysis stream and exist only for the life of the run.
 */
export function ActivityLog({ entries, startedAt }: ActivityLogProps) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  const columns = useMemo(
    () => [
      activityColumn.accessor('at', {
        header: 'Time',
        cell: info => <span className="log-time">{elapsed(info.getValue(), startedAt)}</span>,
      }),
      activityColumn.display({
        id: 'kind',
        header: 'Kind',
        cell: ({ row }) => {
          const kind = classifyLog(row.original.raw, row.original.content)
          return <span className={`log-severity log-kind-${kind}`}>{LOG_KIND_LABEL[kind]}</span>
        },
      }),
      activityColumn.display({
        id: 'message',
        header: 'Message',
        cell: ({ row }) => (
          <div className="log-message">
            <LogMarkdown content={summarizeLog(row.original.raw, row.original.content)} />
          </div>
        ),
      }),
    ],
    [startedAt]
  )

  const table = useReactTable({
    data: entries,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (entries.length === 0) {
    return <p className="activity-log-empty">No activity yet.</p>
  }

  return (
    <div className="activity-log">
      <div className="log-table-wrapper">
        <table className="log-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => {
              const idx = row.index
              const isOpen = !!expanded[idx]
              return (
                <Fragment key={row.id}>
                  <tr
                    className={isOpen ? 'selected' : ''}
                    onClick={() => setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }))}
                    title="Click to show the raw message"
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="log-raw-row">
                      <td colSpan={3}>
                        <pre className="log-raw">{JSON.stringify(row.original.raw, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
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
