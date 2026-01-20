import { useState, useEffect, useCallback } from 'react'
import { isUserAdmin, getCurrentUser } from './api'

export function useToast(duration = 1500) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), duration)
      return () => clearTimeout(timer)
    }
  }, [message, duration])

  const showToast = useCallback((msg: string) => {
    setMessage(msg)
  }, [])

  return { toastMessage: message, showToast }
}

export function useCopyToClipboard(showToast: (msg: string) => void) {
  const copyMarkdownContent = useCallback((selector: string, fallbackText: string) => {
    const element = document.querySelector(selector)
    if (element) {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(element)
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.execCommand('copy')
      selection?.removeAllRanges()
      showToast('✓ Copied')
    } else {
      navigator.clipboard.writeText(fallbackText)
      showToast('✓ Copied')
    }
  }, [showToast])

  const copyText = useCallback((text: string, successMessage = '✓ Copied') => {
    navigator.clipboard.writeText(text)
    showToast(successMessage)
  }, [showToast])

  return { copyMarkdownContent, copyText }
}

export function useAdmin() {
  const [admin, setAdmin] = useState(false)

  useEffect(() => {
    const checkAdmin = async () => {
      const user = getCurrentUser()
      if (!user) return

      try {
        const result = await isUserAdmin(user.uid)
        setAdmin(result)
      } catch (err) {
        console.error('Error checking admin status:', err)
      }
    }

    checkAdmin()
  }, [])

  return admin
}
