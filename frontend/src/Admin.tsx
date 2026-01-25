import { useState, useEffect, useMemo } from 'react'
import {
  subscribeToAllUsers,
  subscribeToAdminData,
  approveUser as apiApproveUser,
  updateAdminGmail,
  createInvite,
  revokeInvite,
  subscribeToInvites,
  subscribeToInterviewTypes,
  createInterviewType,
  updateInterviewType,
  deleteInterviewType,
  type UserRecord,
  type InviteRecord,
  type AdminRecord,
  type InterviewTypeRecord,
} from './api'
import { Loading, LogViewer } from './components'
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

// Confirmation dialog state
interface ConfirmDialog {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
}

type AdminSection = 'gmail' | 'invites' | 'users' | 'jobtypes' | 'logs'

export function Admin() {
  const { user } = useAuth()
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [adminData, setAdminData] = useState<AdminRecord | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [activeSection, setActiveSection] = useState<AdminSection>('gmail')

  // Invite state
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null)

  // Interview types state
  const [interviewTypes, setInterviewTypes] = useState<InterviewTypeRecord[]>([])
  const [editingType, setEditingType] = useState<InterviewTypeRecord | null>(null)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeId, setNewTypeId] = useState('')
  const [newTypeCriteria, setNewTypeCriteria] = useState('')
  const [savingType, setSavingType] = useState(false)
  const [typeError, setTypeError] = useState('')
  const [showTypeForm, setShowTypeForm] = useState(false)

  // Error/notification state
  const [notification, setNotification] = useState<{ type: 'error' | 'success', title: string, message: string } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>({ open: false, title: '', message: '', onConfirm: () => {} })

  const showError = (title: string, message: string) => {
    setNotification({ type: 'error', title, message })
  }

  const clearNotification = () => {
    setNotification(null)
  }

  const showConfirm = (title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({
        open: true,
        title,
        message,
        onConfirm: () => {
          setConfirmDialog(prev => ({ ...prev, open: false }))
          resolve(true)
        }
      })
    })
  }

  const cancelConfirm = () => {
    setConfirmDialog(prev => ({ ...prev, open: false }))
  }

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
    // Subscribe to admin data for Gmail status
    const unsubscribe = subscribeToAdminData(user.uid, (data) => {
      setAdminData(data)
    })

    return () => unsubscribe()
  }, [user.uid])

  // Derived state for Gmail authorization - must have refresh_token to be valid
  const gmailAuthorized = !!(adminData?.gmailTokens?.refresh_token)

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

  // Subscribe to interview types
  useEffect(() => {
    const unsubscribe = subscribeToInterviewTypes((types) => {
      setInterviewTypes(types)
    })
    return () => unsubscribe()
  }, [])

  const handleApproveUser = async (userId: string) => {
    setApproving(userId)
    try {
      await apiApproveUser(userId)
    } catch (error) {
      console.error('Error approving user:', error)
      showError('Failed to approve user', getErrorMessage(error))
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
      showError('Failed to revoke invite', getErrorMessage(error))
    } finally {
      setRevokingInvite(null)
    }
  }

  // Interview type handlers
  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  const handleSaveType = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = editingType ? editingType.name : newTypeName.trim()
    const id = editingType ? editingType.id : newTypeId.trim() || generateSlug(newTypeName)
    const criteria = editingType ? editingType.criteria : newTypeCriteria.trim()

    if (!name || !criteria) {
      setTypeError('Name and criteria are required')
      return
    }

    setSavingType(true)
    setTypeError('')

    try {
      if (editingType) {
        await updateInterviewType(id, name, criteria)
      } else {
        await createInterviewType(id, name, criteria)
      }
      // Reset form
      setNewTypeName('')
      setNewTypeId('')
      setNewTypeCriteria('')
      setEditingType(null)
      setShowTypeForm(false)
    } catch (error) {
      setTypeError(getErrorMessage(error))
    } finally {
      setSavingType(false)
    }
  }

  const handleEditType = (type: InterviewTypeRecord) => {
    setEditingType(type)
    setShowTypeForm(true)
    setTypeError('')
  }

  const handleDeleteType = async (id: string) => {
    const confirmed = await showConfirm(
      'Delete Job Type?',
      'This will permanently delete this job type. Existing analyses using this type will not be affected.'
    )
    if (!confirmed) return

    try {
      await deleteInterviewType(id)
    } catch (error) {
      showError('Failed to delete job type', getErrorMessage(error))
    }
  }

  const handleCancelTypeEdit = () => {
    setEditingType(null)
    setShowTypeForm(false)
    setNewTypeName('')
    setNewTypeId('')
    setNewTypeCriteria('')
    setTypeError('')
  }

  const authorizeGmail = () => {
    const authUrl = `https://us-central1-interview-analyzer-prod.cloudfunctions.net/authorizeGmail?adminUid=${user.uid}`
    window.open(authUrl, '_blank', 'width=600,height=700')
  }

  const disconnectGmail = async () => {
    const confirmed = await showConfirm(
      'Disconnect Gmail?',
      'You will need to re-authorize to send approval and invite emails.'
    )
    if (!confirmed) return

    try {
      await updateAdminGmail(user.uid, null, null)
    } catch (error) {
      console.error('Error disconnecting Gmail:', error)
      showError('Failed to disconnect Gmail', getErrorMessage(error))
    }
  }

  if (loading) {
    return <Loading message="Loading admin dashboard..." />
  }

  // Helper to parse Firestore timestamp or ISO string to Date
  const parseTimestamp = (value: unknown): Date | null => {
    if (!value) return null
    // Firestore Timestamp object has toDate() method
    if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate()
    }
    // Firestore Timestamp might come as { seconds, nanoseconds }
    if (typeof value === 'object' && value !== null && 'seconds' in value) {
      return new Date((value as { seconds: number }).seconds * 1000)
    }
    // ISO string
    if (typeof value === 'string') {
      const date = new Date(value)
      return isNaN(date.getTime()) ? null : date
    }
    return null
  }

  // Calculate Gmail token health
  const getGmailHealth = () => {
    if (!adminData?.gmailTokens) return null

    const authorizedAt = parseTimestamp(adminData.gmailAuthorizedAt)
    const refreshedAt = parseTimestamp(adminData.gmailTokenRefreshedAt)
    const lastActive = refreshedAt || authorizedAt

    if (adminData.gmailTokenError) {
      return { status: 'error', message: adminData.gmailTokenError, lastActive }
    }

    if (lastActive) {
      const daysSince = Math.floor((Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24))
      if (daysSince < 7) return { status: 'healthy', message: `Active ${daysSince === 0 ? 'today' : daysSince + ' days ago'}`, lastActive }
      if (daysSince < 30) return { status: 'warning', message: `Last active ${daysSince} days ago`, lastActive }
      return { status: 'stale', message: `Last active ${daysSince} days ago - may need refresh`, lastActive }
    }

    return { status: 'unknown', message: 'Status unknown', lastActive: null }
  }

  const gmailHealth = getGmailHealth()
  const pendingUsersCount = users.filter(u => !u.approved).length

  const navItems: { id: AdminSection; label: string; badge?: number }[] = [
    { id: 'gmail', label: 'Gmail Integration' },
    { id: 'invites', label: 'Invitations', badge: invites.length || undefined },
    { id: 'users', label: 'Users', badge: pendingUsersCount || undefined },
    { id: 'jobtypes', label: 'Job Types', badge: interviewTypes.length || undefined },
    { id: 'logs', label: 'Logs' },
  ]

  return (
    <div className="admin-layout">
      {/* Confirmation Dialog */}
      {confirmDialog.open && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h3>{confirmDialog.title}</h3>
            <p>{confirmDialog.message}</p>
            <div className="dialog-actions">
              <button className="dialog-cancel" onClick={cancelConfirm}>Cancel</button>
              <button className="dialog-confirm" onClick={confirmDialog.onConfirm}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="admin-sidebar">
        <nav className="admin-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`admin-nav-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="nav-label">{item.label}</span>
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="admin-main">
        {/* Notification Panel */}
        {notification && (
          <div className={`notification-panel notification-${notification.type}`}>
            <div className="notification-content">
              <span className="notification-icon">{notification.type === 'error' ? '✕' : '✓'}</span>
              <div className="notification-text">
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
              </div>
            </div>
            <button className="notification-close" onClick={clearNotification}>Dismiss</button>
          </div>
        )}

        {/* Gmail Section */}
        {activeSection === 'gmail' && (
          <div className="admin-section">
            <div className="section-body">
              {gmailAuthorized ? (
                <div className="gmail-connected">
                  <div className="gmail-status-container">
                    <div className="gmail-status">
                      <span className={`status-icon ${gmailHealth?.status === 'error' ? 'error' : gmailHealth?.status === 'warning' || gmailHealth?.status === 'stale' ? 'warning' : 'success'}`}>
                        {gmailHealth?.status === 'error' ? '✕' : gmailHealth?.status === 'warning' || gmailHealth?.status === 'stale' ? '⚠' : '✓'}
                      </span>
                      <span>Gmail Connected</span>
                    </div>
                    {gmailHealth && (
                      <span className={`gmail-health gmail-health-${gmailHealth.status}`}>
                        {gmailHealth.message}
                      </span>
                    )}
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
                    Connect Gmail
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Invites Section */}
        {activeSection === 'invites' && (
          <div className="admin-section">
            <div className="section-body">
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

              {invites.length === 0 && (
                <div className="empty-state">
                  <p>No pending invites. Use the form above to invite users.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Users Section */}
        {activeSection === 'users' && (
          <div className="admin-section">
            <div className="section-body">
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
        )}

        {/* Job Types Section */}
        {activeSection === 'jobtypes' && (
          <div className="admin-section">
            <div className="section-body">
              {/* Add/Edit Form */}
              {showTypeForm ? (
                <form onSubmit={handleSaveType} className="jobtype-form">
                  <h3>{editingType ? 'Edit Job Type' : 'Add New Job Type'}</h3>

                  {typeError && <div className="invite-error">{typeError}</div>}

                  <div className="form-group">
                    <label>Name</label>
                    <input
                      type="text"
                      value={editingType ? editingType.name : newTypeName}
                      onChange={(e) => {
                        if (editingType) {
                          setEditingType({ ...editingType, name: e.target.value })
                        } else {
                          setNewTypeName(e.target.value)
                          if (!newTypeId) {
                            setNewTypeId(generateSlug(e.target.value))
                          }
                        }
                      }}
                      placeholder="e.g., Google APM"
                      className="invite-input"
                      disabled={savingType}
                    />
                  </div>

                  {!editingType && (
                    <div className="form-group">
                      <label>ID (slug)</label>
                      <input
                        type="text"
                        value={newTypeId}
                        onChange={(e) => setNewTypeId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        placeholder="e.g., google-apm"
                        className="invite-input"
                        disabled={savingType}
                      />
                      <span className="form-hint">Used internally. Auto-generated from name if left empty.</span>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Evaluation Criteria</label>
                    <textarea
                      value={editingType ? editingType.criteria : newTypeCriteria}
                      onChange={(e) => {
                        if (editingType) {
                          setEditingType({ ...editingType, criteria: e.target.value })
                        } else {
                          setNewTypeCriteria(e.target.value)
                        }
                      }}
                      placeholder="Enter the evaluation criteria for this interview type..."
                      className="criteria-textarea"
                      rows={10}
                      disabled={savingType}
                    />
                  </div>

                  <div className="form-actions">
                    <button
                      type="button"
                      onClick={handleCancelTypeEdit}
                      className="disconnect-button"
                      disabled={savingType}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="invite-button"
                      disabled={savingType}
                    >
                      {savingType ? 'Saving...' : (editingType ? 'Update' : 'Create')}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    onClick={() => setShowTypeForm(true)}
                    className="invite-button"
                    style={{ marginBottom: '1rem' }}
                  >
                    + Add Job Type
                  </button>

                  {interviewTypes.length === 0 ? (
                    <div className="empty-state">
                      <p>No job types defined. Add one to get started.</p>
                    </div>
                  ) : (
                    <div className="jobtype-list">
                      {interviewTypes.map((type) => (
                        <div key={type.id} className="jobtype-item">
                          <div className="jobtype-info">
                            <div className="jobtype-name">{type.name}</div>
                            <div className="jobtype-id">{type.id}</div>
                            <div className="jobtype-criteria-preview">
                              {type.criteria.substring(0, 150)}
                              {type.criteria.length > 150 ? '...' : ''}
                            </div>
                          </div>
                          <div className="jobtype-actions">
                            <button
                              onClick={() => handleEditType(type)}
                              className="disconnect-button"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteType(type.id)}
                              className="revoke-button"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Logs Section */}
        {activeSection === 'logs' && (
          <div className="admin-section">
            <div className="section-body section-body-logs">
              <LogViewer defaultHoursAgo={24} defaultLimit={100} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
