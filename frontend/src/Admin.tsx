import { useState, useEffect, useMemo } from 'react'
import {
  subscribeToAllUsers,
  subscribeToAdminData,
  approveUser as apiApproveUser,
  updateAdminGmail,
  createInvite,
  revokeInvite,
  subscribeToInvites,
  type UserRecord,
  type InviteRecord,
} from './api'
import { Loading } from './components'
import { useAuth } from './App'
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

type PendingInvite = InviteRecord & { id: string }

export function Admin() {
  const { user } = useAuth()
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [gmailAuthorized, setGmailAuthorized] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  // Invite state
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null)

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
    const unsubscribe = subscribeToAdminData(user.uid, (data) => {
      setGmailAuthorized(!!data?.gmailTokens)
    })

    return () => unsubscribe()
  }, [user.uid])

  useEffect(() => {
    // Listen for real-time updates to invites
    const unsubscribe = subscribeToInvites(
      (invitesList) => {
        // Filter out expired invites on the client side
        const now = new Date()
        const validInvites = invitesList.filter(
          (invite) => new Date(invite.expiresAt) > now
        )
        setInvites(validInvites)
      },
      (error) => {
        setInviteError('Failed to load invites: ' + getErrorMessage(error))
      }
    )

    return () => unsubscribe()
  }, [])

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

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return

    setInviteError('')
    setInviteSuccess('')
    setSendingInvite(true)

    try {
      await createInvite(inviteEmail.trim(), user.uid)
      setInviteSuccess(`Invite sent to ${inviteEmail}`)
      setInviteEmail('')
      setTimeout(() => setInviteSuccess(''), 5000)
    } catch (error) {
      console.error('Error sending invite:', error)
      setInviteError('Failed to send invite: ' + getErrorMessage(error))
    } finally {
      setSendingInvite(false)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    setRevokingInvite(inviteId)
    try {
      await revokeInvite(inviteId)
    } catch (error) {
      console.error('Error revoking invite:', error)
      alert('Error revoking invite: ' + getErrorMessage(error))
    } finally {
      setRevokingInvite(null)
    }
  }

  const authorizeGmail = () => {
    const authUrl = `https://us-central1-interview-analyzer-prod.cloudfunctions.net/authorizeGmail?adminUid=${user.uid}`
    window.open(authUrl, '_blank', 'width=600,height=700')
  }

  const disconnectGmail = async () => {
    if (!confirm('Are you sure you want to disconnect Gmail? You will need to re-authorize to send approval emails.')) {
      return
    }

    try {
      await updateAdminGmail(user.uid, null, null)
    } catch (error) {
      console.error('Error disconnecting Gmail:', error)
      alert('Error disconnecting Gmail: ' + getErrorMessage(error))
    }
  }

  if (loading) {
    return <Loading message="Loading admin dashboard..." />
  }

  return (
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

        {/* Invite Section */}
        <div className="invite-section">
          <h2>Invite Users</h2>
          <form onSubmit={handleSendInvite} className="invite-form">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email address"
              className="invite-input"
              disabled={sendingInvite}
            />
            <button
              type="submit"
              disabled={sendingInvite || !inviteEmail.trim()}
              className="invite-button"
            >
              {sendingInvite ? 'Sending...' : 'Send Invite'}
            </button>
          </form>

          {inviteError && <div className="invite-error">{inviteError}</div>}
          {inviteSuccess && <div className="invite-success">{inviteSuccess}</div>}

          {invites.length > 0 && (
            <div className="pending-invites">
              <h3>Pending Invites ({invites.length})</h3>
              <ul className="invite-list">
                {invites.map((invite) => {
                  const expiresAt = new Date(invite.expiresAt)
                  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  return (
                    <li key={invite.id} className="invite-item">
                      <div className="invite-info">
                        <span className="invite-email">{invite.email}</span>
                        <div className="invite-meta">
                          <span className="invite-expiry">
                            Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                          </span>
                          {invite.emailSent === true && (
                            <span className="invite-email-status sent">Email sent</span>
                          )}
                          {invite.emailSent === false && (
                            <span className="invite-email-status failed" title={invite.emailError}>
                              Email failed
                            </span>
                          )}
                          {invite.emailSent === undefined && (
                            <span className="invite-email-status pending">Sending...</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={revokingInvite === invite.id}
                        className="revoke-button"
                      >
                        {revokingInvite === invite.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
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
  )
}
