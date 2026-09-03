import { Fragment, type ReactNode } from "react"

interface MarkdownContentProps {
  content: string
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern =
    /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g
  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index))
    }
    const key = `${keyPrefix}-${match.index}`
    if (match[2]) {
      nodes.push(<strong key={key}>{match[2]}</strong>)
    } else if (match[3]) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
          {match[3]}
        </code>,
      )
    } else if (match[4]) {
      nodes.push(<em key={key}>{match[4]}</em>)
    } else if (match[5] && match[6]) {
      nodes.push(
        <a
          key={key}
          href={match[6]}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {match[5]}
        </a>,
      )
    }
    cursor = pattern.lastIndex
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function paragraphLines(lines: string[], keyPrefix: string) {
  return lines.map((line, index) => (
    <Fragment key={`${keyPrefix}-line-${index}`}>
      {index > 0 && <br />}
      {renderInline(line, `${keyPrefix}-inline-${index}`)}
    </Fragment>
  ))
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3)
      const codeLines: string[] = []
      index += 1
      while (
        index < lines.length &&
        !lines[index].trimStart().startsWith("```")
      ) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(
        <pre
          key={`code-${index}`}
          className="overflow-x-auto rounded-md bg-foreground p-3 text-xs text-background"
        >
          <code data-language={language || undefined}>
            {codeLines.join("\n")}
          </code>
        </pre>,
      )
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const className =
        level === 1
          ? "text-lg font-bold"
          : level === 2
            ? "text-base font-semibold"
            : "text-sm font-semibold"
      const children = renderInline(heading[2], `heading-${index}`)
      blocks.push(
        level === 1 ? (
          <h3 key={`heading-${index}`} className={className}>
            {children}
          </h3>
        ) : (
          <h4 key={`heading-${index}`} className={className}>
            {children}
          </h4>
        ),
      )
      index += 1
      continue
    }

    if (/^\s*[-+*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-+*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-+*]\s+/, ""))
        index += 1
      }
      blocks.push(
        <ul key={`ul-${index}`} className="list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`ul-${index}-${itemIndex}`}>
              {renderInline(item, `ul-${index}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""))
        index += 1
      }
      blocks.push(
        <ol key={`ol-${index}`} className="list-decimal space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`ol-${index}-${itemIndex}`}>
              {renderInline(item, `ol-${index}-${itemIndex}`)}
            </li>
          ))}
        </ol>,
      )
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""))
        index += 1
      }
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-2 border-primary/50 pl-3 text-muted-foreground"
        >
          {paragraphLines(quoteLines, `quote-${index}`)}
        </blockquote>,
      )
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^\s*[-+*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !lines[index].trimStart().startsWith("```")
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(
      <p key={`paragraph-${index}`}>
        {paragraphLines(paragraph, `paragraph-${index}`)}
      </p>,
    )
  }

  return <div className="space-y-3">{blocks}</div>
}
