import { AlertCircle, ChefHat, LogOut, RotateCcw, ShieldCheck } from "lucide-react"
import { useEffect } from "react"
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"
import { toast } from "sonner"

import { PageModeSwitch, type PageMode } from "@/components/page-mode-switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider, useAuth } from "@/features/auth/auth-context"
import { AuthPage } from "@/features/auth/auth-page"
import { ChatPanel } from "@/features/chat/chat-panel"
import { DebateArena } from "@/features/debate/components/debate-arena"
import { PreferenceForm } from "@/features/debate/components/preference-form"
import { ResultPanel } from "@/features/debate/components/result-panel"
import { useDebate } from "@/features/debate/hooks/use-debate"
import type { FoodPreference } from "@/types/debate"

const phaseLabel = {
  idle: "待开赛",
  submitting: "连接中",
  streaming: "直播中",
  completed: "已完成",
  error: "需重试",
}

function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, loading, logout } = useAuth()
  const page: PageMode = location.pathname.startsWith("/debate")
    ? "debate"
    : "chat"
  const {
    state,
    audioUrl,
    isAudioLoading,
    start,
    retry,
    cancel,
    reset,
    playResult,
  } = useDebate()

  useEffect(() => {
    document.title =
      page === "chat"
        ? "自由聊 | Cyber Foodie Debate"
        : "AI 校园干饭辩论赛 | Cyber Foodie Debate"
  }, [page])

  const handlePageChange = (nextPage: PageMode) => {
    navigate(nextPage === "chat" ? "/chat" : "/debate")
  }

  const handleSubmit = async (preference: FoodPreference) => {
    const completed = await start(preference)
    if (completed) toast.success("三轮辩论已完成")
  }

  const handleRetry = async () => {
    const completed = await retry()
    if (completed) toast.success("重新连接成功")
  }

  const handlePlay = async () => {
    try {
      await playResult()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "语音播报失败")
    }
  }

  const handleCancel = () => {
    cancel()
    toast.info("已取消本场辩论")
  }

  const handleLogout = async () => {
    try {
      await logout()
      navigate("/chat", { replace: true })
      toast.success("已安全退出")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "退出失败")
    }
  }

  const debatePage = (
    <section className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
      <aside className="lg:sticky lg:top-6">
        <PreferenceForm
          phase={state.phase}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </aside>

      <div className="min-w-0">
        {state.error && (
          <Alert variant="destructive" className="mb-5">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>赛场连接中断</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{state.error}</span>
              <Button size="sm" variant="outline" onClick={handleRetry}>
                <RotateCcw aria-hidden="true" />
                重试
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <DebateArena state={state} />

        {state.result && (
          <ResultPanel
            result={state.result}
            audioUrl={audioUrl}
            isAudioLoading={isAudioLoading}
            onPlay={handlePlay}
            onReset={reset}
          />
        )}
      </div>
    </section>
  )

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-[#fffdf8]">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChefHat className="size-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold sm:text-3xl">
                Cyber Foodie Debate
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {page === "chat"
                  ? "校园干饭搭子，随时聊、随时推荐。"
                  : "两位大厨，三轮交锋，一个明确答案。"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PageModeSwitch value={page} onChange={handlePageChange} />
            {page === "debate" && (
              <>
                <Badge variant="outline" className="bg-background">
                  <ShieldCheck aria-hidden="true" />
                  固定 3 轮
                </Badge>
                <Badge
                  className={
                    state.phase === "streaming"
                      ? "bg-[#277a68] text-white hover:bg-[#277a68]"
                      : undefined
                  }
                  variant={state.phase === "streaming" ? "default" : "secondary"}
                >
                  {phaseLabel[state.phase]}
                </Badge>
              </>
            )}
            {!loading &&
              (user ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {user.display_name || user.email}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={handleLogout}>
                    <LogOut aria-hidden="true" />
                    退出
                  </Button>
                </div>
              ) : (
                <>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/login">登录</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link to="/register">注册</Link>
                  </Button>
                </>
              ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <div
          key={page}
          id={`page-panel-${page}`}
          role="tabpanel"
          aria-labelledby={`page-tab-${page}`}
          className="page-content-enter"
        >
          <Routes>
            <Route path="/chat" element={<ChatPanel />} />
            <Route path="/chat/:conversationId" element={<ChatPanel />} />
            <Route path="/debate" element={debatePage} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </div>
      </main>

      <footer className="border-t bg-[#fffdf8]">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <span>Cyber Foodie Debate</span>
          <span>AI 原生应用工程实践</span>
        </div>
      </footer>
      <Toaster position="top-center" richColors closeButton />
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/*" element={<AppShell />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
