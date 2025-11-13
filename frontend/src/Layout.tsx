import { type User } from 'firebase/auth'
import { Header } from './Header'
import './Layout.css'

interface LayoutProps {
  user: User | null
  isAdmin: boolean
  currentView: 'main' | 'admin'
  children: React.ReactNode
}

export function Layout({ user, isAdmin, currentView, children }: LayoutProps) {
  return (
    <div className="layout">
      <div className="layout-container">
        <Header user={user} isAdmin={isAdmin} currentView={currentView} />
        <main className="layout-content">
          {children}
        </main>
      </div>
    </div>
  )
}
