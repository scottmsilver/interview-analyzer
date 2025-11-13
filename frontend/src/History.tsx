import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, auth } from './firebase'
import { collection, query, where, orderBy, onSnapshot, deleteDoc, doc, getDoc } from 'firebase/firestore'
import { Layout } from './Layout'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import './History.css'

interface Analysis {
  id: string
  userId: string
  interviewType: string
  transcriptFileName: string
  analysis: string
  title: string
  savedAt?: string
  createdAt: string
  updatedAt: string
}

const columnHelper = createColumnHelper<Analysis>()

export function History() {
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true }
  ])
  const navigate = useNavigate()

  useEffect(() => {
    const user = auth.currentUser
    if (!user) {
      navigate('/')
      return
    }

    // Check if user is admin
    const checkAdmin = async () => {
      try {
        const adminRef = doc(db, 'admins', user.uid)
        const adminSnap = await getDoc(adminRef)
        setIsAdmin(adminSnap.exists())
      } catch (err) {
        console.error('Error checking admin status:', err)
      }
    }
    checkAdmin()

    // Listen for real-time updates to user's analyses
    const analysesQuery = query(
      collection(db, 'analyses'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    )

    const unsubscribe = onSnapshot(analysesQuery, (snapshot) => {
      const userAnalyses: Analysis[] = []
      snapshot.forEach((doc) => {
        userAnalyses.push({
          id: doc.id,
          ...doc.data()
        } as Analysis)
      })

      setAnalyses(userAnalyses)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [navigate])

  const deleteAnalysis = async (analysisId: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) {
      return
    }

    setDeleting(analysisId)
    try {
      await deleteDoc(doc(db, 'analyses', analysisId))
    } catch (error) {
      console.error('Error deleting analysis:', error)
      alert('Error deleting analysis: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setDeleting(null)
    }
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

          const createdAt = info.row.original.createdAt
          return `${new Date(createdAt).toLocaleDateString()} at ${new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
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
              onClick={() => deleteAnalysis(row.original.id, row.original.title)}
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
      <Layout user={auth.currentUser} isAdmin={isAdmin} currentView="history">
        <div className="history-container">
          <div className="loading">Loading analyses...</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout user={auth.currentUser} isAdmin={isAdmin} currentView="history">
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
