import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut, type User } from './api'
import './Header.css'

interface HeaderProps {
  user: User | null
  isAdmin: boolean
  currentView: 'main' | 'admin' | 'history' | 'analysis'
}

export function Header({ user, isAdmin, currentView }: HeaderProps) {
  const navigate = useNavigate()
  const [showProfileMenu, setShowProfileMenu] = useState(false)

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.profile-menu-container')) {
        setShowProfileMenu(false)
      }
    }

    if (showProfileMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showProfileMenu])

  const handleLogout = async () => {
    try {
      await signOut()
      setShowProfileMenu(false)
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  return (
    <header className="header">
      <div className="header-content">
        <h1>Interview Analyzer</h1>

        <nav className="header-nav">
          <button
            onClick={() => navigate('/')}
            className={`nav-tab ${currentView === 'main' ? 'active' : ''}`}
          >
            Analyze
          </button>
          <button
            onClick={() => navigate('/history')}
            className={`nav-tab ${currentView === 'history' ? 'active' : ''}`}
          >
            History
          </button>
          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className={`nav-tab ${currentView === 'admin' ? 'active' : ''}`}
            >
              Admin
            </button>
          )}
        </nav>

        <div className="header-actions">
          <div className="profile-menu-container">
            <div
              className="user-avatar-fallback"
              title={user?.email || ''}
              onClick={() => setShowProfileMenu(!showProfileMenu)}
            >
              {user?.email ? user.email.charAt(0).toUpperCase() : 'U'}
            </div>
            {showProfileMenu && (
              <div className="profile-dropdown">
                <div className="profile-dropdown-header">
                  <div className="profile-email">{user?.email}</div>
                </div>
                <button onClick={handleLogout} className="profile-menu-item">
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
