import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUser, subscribeToUserAnalyses, deleteAnalysis as apiDeleteAnalysis } from './api'
import { Layout } from './Layout'
import { Loading } from './components'
import { type AnalysisData, getInterviewTypeLabel, formatDateTime, getErrorMessage } from './types'
import { useAdmin } from './hooks'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import './History.css'

type Analysis = AnalysisData & { id: string }

const columnHelper = createColumnHelper<Analysis>()

export function History() {
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true }
  ])
  const navigate = useNavigate()
  const isAdmin = useAdmin()

  const user = getCurrentUser()

  useEffect(() => {
    if (!user) {
      navigate('/')
      return
    }

    // Listen for real-time updates to user's analyses
    const unsubscribe = subscribeToUserAnalyses(user.uid, (userAnalyses) => {
      setAnalyses(userAnalyses)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [navigate, user])

  const handleDeleteAnalysis = async (analysisId: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) {
      return
    }

    setDeleting(analysisId)
    try {
      await apiDeleteAnalysis(analysisId)
    } catch (error) {
      console.error('Error deleting analysis:', error)
      alert('Error deleting analysis: ' + getErrorMessage(error))
    } finally {
      setDeleting(null)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('title', {
        header: 'Title',
        cell: info => (
          <button
            className="table-link"
            onClick={() => navigate(`/analysis/${info.row.original.id}`)}
          >
            {info.getValue()}
          </button>
        ),
      }),
      columnHelper.accessor('transcriptFileName', {
        header: 'File',
        cell: info => (
          <span className="table-filename">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('interviewType', {
        header: 'Type',
        cell: info => (
          <span className="interview-type-badge">
            {getInterviewTypeLabel(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('savedAt', {
        header: 'Saved',
        cell: info => {
          const value = info.getValue()
          if (value) return value
          return formatDateTime(info.row.original.createdAt)
        },
        sortingFn: (a, b) => {
          const dateA = new Date(a.original.createdAt).getTime()
          const dateB = new Date(b.original.createdAt).getTime()
          return dateA - dateB
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="table-actions">
            <button
              onClick={() => navigate(`/analysis/${row.original.id}`)}
              className="table-action-button view"
              title="View analysis"
            >
              👁️
            </button>
            <button
              onClick={() => handleDeleteAnalysis(row.original.id, row.original.title)}
              disabled={deleting === row.original.id}
              className="table-action-button delete"
              title="Delete analysis"
            >
              {deleting === row.original.id ? '⏳' : '🗑️'}
            </button>
          </div>
        ),
      }),
    ],
    [navigate, deleting]
  )

  const table = useReactTable({
    data: analyses,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (loading) {
    return (
      <Layout user={user} isAdmin={isAdmin} currentView="history">
        <div className="history-container">
          <Loading message="Loading analyses..." />
        </div>
      </Layout>
    )
  }

  return (
    <Layout user={user} isAdmin={isAdmin} currentView="history">
      <div className="history-container">
        {analyses.length === 0 ? (
          <div className="empty-state">
            <p className="empty-message">No analyses yet</p>
            <p className="empty-subtitle">Your saved analyses will appear here</p>
            <button onClick={() => navigate('/')} className="primary-button">
              Start Analyzing
            </button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="analyses-table">
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder ? null : (
                          <div
                            className={header.column.getCanSort() ? 'sortable-header' : ''}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                            {header.column.getIsSorted() && (
                              <span className="sort-indicator">
                                {header.column.getIsSorted() === 'desc' ? ' ↓' : ' ↑'}
                              </span>
                            )}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  )
}
