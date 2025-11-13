import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut, type User } from 'firebase/auth'
import { auth } from './firebase'
import './Header.css'

interface HeaderProps {
  user: User | null
  isAdmin: boolean
  currentView: 'main' | 'admin'
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
      await signOut(auth)
      setShowProfileMenu(false)
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  return (
    <header className="header">
      <div className="header-content">
        <h1>Interview Analyzer</h1>
        <div className="header-actions">
          {isAdmin && (
            <button
              onClick={() => navigate(currentView === 'admin' ? '/' : '/admin')}
              className="admin-link"
            >
              {currentView === 'admin' ? 'Analyzer' : 'Admin'}
            </button>
          )}
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
