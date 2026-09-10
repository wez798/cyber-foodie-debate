import { ChefHat, LogOut } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { PageModeSwitch, type PageMode } from "@/components/page-mode-switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AuthUser } from "@/features/auth/auth-api"

interface AppHeaderProps {
  page: PageMode
  onPageChange: (page: PageMode) => void
  user: AuthUser | null
  loading: boolean
  onLogout: () => void
  // Reserved for future round/state controls; no controls are shown by default.
  pageActions?: ReactNode
}

export function AppHeader({ page, onPageChange, user, loading, onLogout, pageActions }: AppHeaderProps) {
  return (
    <header className="border-b bg-[#fffdf8]">
      <div className="mx-auto grid max-w-[1480px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-4 px-4 py-5 sm:gap-x-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:px-8">
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:size-11">
            <ChefHat className="size-5 sm:size-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold sm:text-2xl xl:text-3xl">Cyber Foodie Debate</h1>
            <p className="mt-1 hidden truncate text-sm text-muted-foreground sm:block">
              {page === "chat" ? "校园干饭搭子，随时聊、随时推荐。" : "两位大厨，三轮交锋，一个明确答案。"}
            </p>
          </div>
        </div>

        <nav aria-label="功能导航" className="col-span-2 row-start-2 flex min-w-0 items-center gap-3 lg:col-span-1 lg:col-start-2 lg:row-start-1">
          <PageModeSwitch value={page} onChange={onPageChange} />
          {pageActions}
        </nav>

        <nav aria-label="账户" aria-busy={loading} className="col-start-2 row-start-1 flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap lg:col-start-3">
          {!loading && (user ? (
            <>
              <Badge variant="secondary" className="min-w-0 max-w-16 sm:max-w-36 lg:max-w-40">
                <span className="truncate" title={user.display_name || user.email}>{user.display_name || user.email}</span>
              </Badge>
              <Button className="shrink-0" size="sm" variant="outline" onClick={onLogout}>
                <LogOut aria-hidden="true" />
                退出登录
              </Button>
            </>
          ) : (
            <>
              <Button className="shrink-0" size="sm" variant="ghost" asChild><Link to="/login">登录</Link></Button>
              <Button className="shrink-0" size="sm" asChild><Link to="/register">注册</Link></Button>
            </>
          ))}
        </nav>
      </div>
    </header>
  )
}
