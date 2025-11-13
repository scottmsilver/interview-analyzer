import { useState, useEffect } from 'react'
import { db, auth } from './firebase'
import { collection, doc, updateDoc, onSnapshot } from 'firebase/firestore'
import { Layout } from './Layout'
import './Admin.css'

interface PendingUser {
  id: string
  email: string
  createdAt: string
  approved: boolean
}

interface AdminData {
  email: string
  gmailTokens?: any
  gmailAuthorizedAt?: any
}

export function Admin() {
  const [pendingUsers, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [gmailAuthorized, setGmailAuthorized] = useState(false)
  const isAdmin = true // Admin page is only accessible by admins

  useEffect(() => {
    // Listen for real-time updates to all users
    const usersRef = collection(db, 'users')
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const users: PendingUser[] = []
      snapshot.forEach((doc) => {
        users.push({
          id: doc.id,
          ...doc.data()
        } as PendingUser)
      })

      // Sort by date, pending first
      users.sort((a, b) => {
        if (a.approved === b.approved) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        }
        return a.approved ? 1 : -1
      })

      setUsers(users)
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

  if (loading) {
    return (
      <Layout user={auth.currentUser} isAdmin={true} currentView="admin">
        <div className="loading">Loading admin dashboard...</div>
      </Layout>
    )
  }

  const pendingCount = pendingUsers.filter(u => !u.approved).length
  const approvedCount = pendingUsers.filter(u => u.approved).length

  return (
    <Layout user={auth.currentUser} isAdmin={isAdmin} currentView="admin">
      <div className="admin-title-section">
        <div>
          <h2>Admin Dashboard</h2>
          <p className="admin-subtitle">Manage user approvals</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {gmailAuthorized ? (
            <div className="gmail-status">
              <span style={{ color: '#10b981', marginRight: '0.5rem' }}>✓</span>
              Gmail Connected
            </div>
          ) : (
            <button onClick={authorizeGmail} className="gmail-button">
              📧 Connect Gmail
            </button>
          )}
        </div>
      </div>

        <div className="admin-stats">
          <div className="stat-card">
            <div className="stat-number">{pendingCount}</div>
            <div className="stat-label">Pending Approval</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{approvedCount}</div>
            <div className="stat-label">Approved Users</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{pendingUsers.length}</div>
            <div className="stat-label">Total Users</div>
          </div>
        </div>

        <div className="users-section">
          <h2>Users</h2>
          {pendingUsers.length === 0 ? (
            <div className="empty-state">
              <p>No users yet. Users will appear here when they sign up.</p>
            </div>
          ) : (
            <div className="users-table">
              <div className="table-wrapper">
                <div className="table-header">
                  <div className="col-status">Status</div>
                  <div className="col-email">Email</div>
                  <div className="col-date">Signed Up</div>
                  <div className="col-actions">Actions</div>
                </div>
                {pendingUsers.map((user) => (
                  <div key={user.id} className={`table-row ${user.approved ? 'approved' : 'pending'}`}>
                    <div className="col-status">
                      {user.approved ? (
                        <span className="status-badge approved">✓ Approved</span>
                      ) : (
                        <span className="status-badge pending">⏳ Pending</span>
                      )}
                    </div>
                    <div className="col-email">{user.email}</div>
                    <div className="col-date">
                      {new Date(user.createdAt).toLocaleDateString()} {new Date(user.createdAt).toLocaleTimeString()}
                    </div>
                    <div className="col-actions">
                      {!user.approved && (
                        <button
                          onClick={() => approveUser(user.id)}
                          disabled={approving === user.id}
                          className="approve-button"
                        >
                          {approving === user.id ? 'Approving...' : 'Approve'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    </Layout>
  )
}
