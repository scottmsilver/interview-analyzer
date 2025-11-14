import { useState, useEffect, useMemo } from 'react'
import { db, auth } from './firebase'
import { collection, doc, updateDoc, onSnapshot } from 'firebase/firestore'
import { Layout } from './Layout'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import './Admin.css'

interface PendingUser {
  id: string
  email: string
  createdAt: string
  approved: boolean
  approvedAt?: string
}

interface AdminData {
  email: string
  gmailTokens?: any
  gmailAuthorizedAt?: any
}

const columnHelper = createColumnHelper<PendingUser>()

export function Admin() {
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [gmailAuthorized, setGmailAuthorized] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const isAdmin = true // Admin page is only accessible by admins

  // Define columns
  const columns = useMemo(
    () => [
      columnHelper.accessor('approved', {
        header: 'Status',
        cell: (info) => (
          info.getValue() ? (
            <span className="status-badge approved">✓ Approved</span>
          ) : (
            <span className="status-badge pending">⏳ Pending</span>
          )
        ),
        sortingFn: (rowA, rowB) => {
          // Unapproved users come first
          if (rowA.original.approved === rowB.original.approved) return 0
          return rowA.original.approved ? 1 : -1
        }
      }),
      columnHelper.accessor('email', {
        header: 'Email',
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('createdAt', {
        header: 'Signed Up',
        cell: (info) => {
          const date = new Date(info.getValue())
          return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const user = row.original
          if (!user.approved) {
            return (
              <button
                onClick={() => approveUser(user.id)}
                disabled={approving === user.id}
                className="approve-button"
              >
                {approving === user.id ? 'Approving...' : 'Approve'}
              </button>
            )
          }
          return null
        },
      }),
    ],
    [approving]
  )

  // Sort users: unapproved first, then by date
  const sortedUsers = useMemo(() => {
    const sorted = [...users].sort((a, b) => {
      // First sort by approval status
      if (a.approved !== b.approved) {
        return a.approved ? 1 : -1
      }
      // Then sort by date (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
    return sorted
  }, [users])

  const table = useReactTable({
    data: sortedUsers,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  })

  useEffect(() => {
    // Listen for real-time updates to all users
    const usersRef = collection(db, 'users')
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const usersList: PendingUser[] = []
      snapshot.forEach((doc) => {
        usersList.push({
          id: doc.id,
          ...doc.data()
        } as PendingUser)
      })
      setUsers(usersList)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    // Check if admin has authorized Gmail
    const checkGmailAuth = async () => {
      const user = auth.currentUser
      if (!user) return

      const adminRef = doc(db, 'admins', user.uid)
      const unsubscribe = onSnapshot(adminRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as AdminData
          setGmailAuthorized(!!data.gmailTokens)
        }
      })

      return () => unsubscribe()
    }

    checkGmailAuth()
  }, [])

  const approveUser = async (userId: string) => {
    setApproving(userId)
    try {
      await updateDoc(doc(db, 'users', userId), {
        approved: true,
        approvedAt: new Date().toISOString()
      })
    } catch (error) {
      console.error('Error approving user:', error)
      alert('Error approving user: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setApproving(null)
    }
  }

  const authorizeGmail = () => {
    const user = auth.currentUser
    if (!user) return

    const authUrl = `https://us-central1-interview-analyzer-prod.cloudfunctions.net/authorizeGmail?adminUid=${user.uid}`
    window.open(authUrl, '_blank', 'width=600,height=700')
  }

  const disconnectGmail = async () => {
    const user = auth.currentUser
    if (!user) return

    if (!confirm('Are you sure you want to disconnect Gmail? You will need to re-authorize to send approval emails.')) {
      return
    }

    try {
      await updateDoc(doc(db, 'admins', user.uid), {
        gmailTokens: null,
        gmailAuthorizedAt: null
      })
    } catch (error) {
      console.error('Error disconnecting Gmail:', error)
      alert('Error disconnecting Gmail: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  if (loading) {
    return (
      <Layout user={auth.currentUser} isAdmin={true} currentView="admin">
        <div className="loading">Loading admin dashboard...</div>
      </Layout>
    )
  }

  return (
    <Layout user={auth.currentUser} isAdmin={isAdmin} currentView="admin">
      <div className="admin-container">
        {/* Gmail Section */}
        <div className="gmail-section">
          <div className="section-content">
            {gmailAuthorized ? (
              <div className="gmail-connected">
                <div className="gmail-status">
                  <span className="status-icon success">✓</span>
                  <span>Gmail Connected</span>
                </div>
                <button onClick={disconnectGmail} className="disconnect-button" title="Disconnect Gmail">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="gmail-disconnected">
                <div className="gmail-status">
                  <span className="status-icon warning">⚠</span>
                  <span>Gmail Not Connected</span>
                </div>
                <button onClick={authorizeGmail} className="connect-button">
                  Connect Gmail to Send Approval Emails
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Users Section */}
        <div className="users-section">
          <div className="users-header">
            <h2>Users ({users.length})</h2>
            <div className="users-stats">
              <span className="stat">
                Pending: {users.filter(u => !u.approved).length}
              </span>
              <span className="stat">
                Approved: {users.filter(u => u.approved).length}
              </span>
            </div>
          </div>

          {users.length === 0 ? (
            <div className="empty-state">
              <p>No users yet. Users will appear here when they sign up.</p>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                      <tr key={headerGroup.id}>
                        {headerGroup.headers.map(header => (
                          <th key={header.id}>
                            {header.isPlaceholder ? null : (
                              <div
                                className={header.column.getCanSort() ? 'sortable' : ''}
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                {flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                                {{
                                  asc: ' ↑',
                                  desc: ' ↓',
                                }[header.column.getIsSorted() as string] ?? null}
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map(row => (
                      <tr key={row.id} className={row.original.approved ? 'approved' : 'pending'}>
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

              {/* Pagination */}
              {table.getPageCount() > 1 && (
                <div className="pagination">
                  <button
                    onClick={() => table.setPageIndex(0)}
                    disabled={!table.getCanPreviousPage()}
                  >
                    {'<<'}
                  </button>
                  <button
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    {'<'}
                  </button>
                  <span className="page-info">
                    Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                  </span>
                  <button
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    {'>'}
                  </button>
                  <button
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
                  >
                    {'>>'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}
