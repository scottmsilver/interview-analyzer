import { useState, useEffect, useMemo } from 'react'
import {
  getCurrentUser,
  subscribeToAllUsers,
  subscribeToAdminData,
  approveUser as apiApproveUser,
  updateAdminGmail,
  type UserRecord,
} from './api'
import { Layout } from './Layout'
import { Loading } from './components'
import { formatDateTime, getErrorMessage } from './types'
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

type PendingUser = UserRecord & { id: string }

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
        cell: (info) => formatDateTime(info.getValue()),
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const user = row.original
          if (!user.approved) {
            return (
              <button
                onClick={() => handleApproveUser(user.id)}
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

  const currentUser = getCurrentUser()

  useEffect(() => {
    // Listen for real-time updates to all users
    const unsubscribe = subscribeToAllUsers((usersList) => {
      setUsers(usersList)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    // Check if admin has authorized Gmail
    if (!currentUser) return

    const unsubscribe = subscribeToAdminData(currentUser.uid, (data) => {
      setGmailAuthorized(!!data?.gmailTokens)
    })

    return () => unsubscribe()
  }, [currentUser])

  const handleApproveUser = async (userId: string) => {
    setApproving(userId)
    try {
      await apiApproveUser(userId)
    } catch (error) {
      console.error('Error approving user:', error)
      alert('Error approving user: ' + getErrorMessage(error))
    } finally {
      setApproving(null)
    }
  }

  const authorizeGmail = () => {
    if (!currentUser) return

    const authUrl = `https://us-central1-interview-analyzer-prod.cloudfunctions.net/authorizeGmail?adminUid=${currentUser.uid}`
    window.open(authUrl, '_blank', 'width=600,height=700')
  }

  const disconnectGmail = async () => {
    if (!currentUser) return

    if (!confirm('Are you sure you want to disconnect Gmail? You will need to re-authorize to send approval emails.')) {
      return
    }

    try {
      await updateAdminGmail(currentUser.uid, null, null)
    } catch (error) {
      console.error('Error disconnecting Gmail:', error)
      alert('Error disconnecting Gmail: ' + getErrorMessage(error))
    }
  }

  if (loading) {
    return (
      <Layout user={currentUser} isAdmin={true} currentView="admin">
        <Loading message="Loading admin dashboard..." />
      </Layout>
    )
  }

  return (
    <Layout user={currentUser} isAdmin={isAdmin} currentView="admin">
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
