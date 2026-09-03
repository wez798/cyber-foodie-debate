import { MessageCircleMore, Swords } from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react"

export type PageMode = "chat" | "debate"

interface PageModeSwitchProps {
  value: PageMode
  onChange: (page: PageMode) => void
}

interface Ripple {
  id: number
  page: PageMode
  x: number
  y: number
  size: number
}

const pages: Array<{
  value: PageMode
  label: string
  icon: typeof MessageCircleMore
}> = [
  { value: "chat", label: "自由聊", icon: MessageCircleMore },
  { value: "debate", label: "辩论赛", icon: Swords },
]

export function PageModeSwitch({ value, onChange }: PageModeSwitchProps) {
  const [ripples, setRipples] = useState<Ripple[]>([])
  const rippleId = useRef(0)
  const rippleTimers = useRef(new Map<number, number>())
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(
    () => () => {
      rippleTimers.current.forEach((timer) => window.clearTimeout(timer))
      rippleTimers.current.clear()
    },
    [],
  )

  const removeRipple = (id: number) => {
    const timer = rippleTimers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    rippleTimers.current.delete(id)
    setRipples((current) => current.filter((ripple) => ripple.id !== id))
  }

  const moveGlow = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty(
      "--glow-x",
      `${event.clientX - bounds.left}px`,
    )
    event.currentTarget.style.setProperty(
      "--glow-y",
      `${event.clientY - bounds.top}px`,
    )
  }

  const selectPage = (page: PageMode, focusIndex?: number) => {
    onChange(page)
    if (focusIndex !== undefined) tabRefs.current[focusIndex]?.focus()
  }

  const handleClick = (
    event: MouseEvent<HTMLButtonElement>,
    page: PageMode,
  ) => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
    if (!reduceMotion) {
      const bounds = event.currentTarget.getBoundingClientRect()
      const size = Math.max(bounds.width, bounds.height) * 1.8
      rippleId.current += 1
      const id = rippleId.current
      setRipples((current) => [
        ...current,
        {
          id,
          page,
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          size,
        },
      ])
      const timer = window.setTimeout(() => removeRipple(id), 500)
      rippleTimers.current.set(id, timer)
    }
    onChange(page)
  }

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % pages.length
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + pages.length) % pages.length
    } else if (event.key === "Home") {
      nextIndex = 0
    } else if (event.key === "End") {
      nextIndex = pages.length - 1
    }
    if (nextIndex === null) return
    event.preventDefault()
    selectPage(pages[nextIndex].value, nextIndex)
  }

  return (
    <div
      role="tablist"
      aria-label="功能页面"
      className="page-mode-switch"
      data-page={value}
    >
      <span
        className="page-mode-indicator"
        data-page={value}
        aria-hidden="true"
      />
      {pages.map((page, index) => {
        const Icon = page.icon
        const selected = value === page.value
        return (
          <button
            key={page.value}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            id={`page-tab-${page.value}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`page-panel-${page.value}`}
            tabIndex={selected ? 0 : -1}
            className="page-mode-tab"
            data-selected={selected}
            onPointerMove={moveGlow}
            onClick={(event) => handleClick(event, page.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="page-mode-label">
              <Icon className="size-4" aria-hidden="true" />
              {page.label}
            </span>
            {ripples
              .filter((ripple) => ripple.page === page.value)
              .map((ripple) => (
                <span
                  key={ripple.id}
                  data-testid="page-mode-ripple"
                  className="page-mode-ripple"
                  style={
                    {
                      "--ripple-x": `${ripple.x}px`,
                      "--ripple-y": `${ripple.y}px`,
                      "--ripple-size": `${ripple.size}px`,
                    } as CSSProperties
                  }
                  onAnimationEnd={() => removeRipple(ripple.id)}
                  aria-hidden="true"
                />
              ))}
          </button>
        )
      })}
    </div>
  )
}
