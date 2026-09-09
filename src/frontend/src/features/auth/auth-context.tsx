import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  type AuthCredentials,
  type AuthUser,
} from "@/features/auth/auth-api"
import { ApiError } from "@/lib/api-client"

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (credentials: AuthCredentials) => Promise<void>
  register: (credentials: AuthCredentials) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const operationRef = useRef(0)

  const refresh = useCallback(async () => {
    const operation = ++operationRef.current
    try {
      const restored = await getCurrentUser()
      if (operationRef.current === operation) setUser(restored)
    } catch {
      if (operationRef.current === operation) setUser(null)
    } finally {
      if (operationRef.current === operation) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const operation = operationRef.current
    void getCurrentUser(controller.signal)
      .then((restored) => {
        if (!controller.signal.aborted && operationRef.current === operation) {
          setUser(restored)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && operationRef.current === operation) {
          setUser(null)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && operationRef.current === operation) {
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [])

  const login = useCallback(async (credentials: AuthCredentials) => {
    const operation = ++operationRef.current
    try {
      const authenticated = await loginUser(credentials)
      if (operationRef.current === operation) setUser(authenticated)
    } finally {
      if (operationRef.current === operation) setLoading(false)
    }
  }, [])

  const register = useCallback(async (credentials: AuthCredentials) => {
    const operation = ++operationRef.current
    try {
      const authenticated = await registerUser(credentials)
      if (operationRef.current === operation) setUser(authenticated)
    } finally {
      if (operationRef.current === operation) setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    ++operationRef.current
    try {
      await logoutUser()
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
    }
    ++operationRef.current
    setUser(null)
    setLoading(false)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth 必须在 AuthProvider 中使用")
  return value
}
