import { AlertCircle, ChefHat, LogIn, UserPlus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/auth-context"

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, loading, login, register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRegister = mode === "register"

  if (!loading && user) return <Navigate to="/chat" replace />

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      if (isRegister) {
        await register({
          email,
          password,
          display_name: displayName.trim() || undefined,
        })
      } else {
        await login({ email, password })
      }
      navigate("/chat", { replace: true })
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "认证请求失败",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/25 px-4 py-10">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ChefHat aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">
            {isRegister ? "创建账号" : "欢迎回来"}
          </CardTitle>
          <CardDescription>
            {isRegister
              ? "注册后可跨设备保存聊天记录"
              : "登录以继续访问你的云端会话"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-5">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {isRegister && (
              <div className="space-y-2">
                <Label htmlFor="display-name">昵称（选填）</Label>
                <Input
                  id="display-name"
                  autoComplete="nickname"
                  maxLength={80}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={pending}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                minLength={1}
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
              />
              {isRegister && (
                <p className="text-xs text-muted-foreground">
                  密码强度由服务端策略校验；当前版本尚未提供邮件验证与密码找回。
                </p>
              )}
            </div>
            <Button className="w-full" type="submit" disabled={pending}>
              {isRegister ? <UserPlus aria-hidden="true" /> : <LogIn aria-hidden="true" />}
              {pending ? "处理中…" : isRegister ? "注册并登录" : "登录"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {isRegister ? "已有账号？" : "还没有账号？"}{" "}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              to={isRegister ? "/login" : "/register"}
            >
              {isRegister ? "去登录" : "去注册"}
            </Link>
          </p>
          <p className="mt-3 text-center text-sm">
            <Link className="text-muted-foreground hover:text-foreground" to="/chat">
              暂不登录，继续游客模式
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
