export interface ServerSentEvent {
  event: string
  data: string
  id?: string
  retry?: number
}

function parseEventBlock(block: string): ServerSentEvent | null {
  const dataLines: string[] = []
  let event = "message"
  let id: string | undefined
  let retry: number | undefined

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue

    const colonIndex = line.indexOf(":")
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex)
    let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1)
    if (value.startsWith(" ")) value = value.slice(1)

    if (field === "event") event = value
    if (field === "data") dataLines.push(value)
    if (field === "id" && !value.includes("\0")) id = value
    if (field === "retry" && /^\d+$/.test(value)) retry = Number(value)
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join("\n"), id, retry }
}

export class SseParser {
  private buffer = ""

  push(chunk: string): ServerSentEvent[] {
    this.buffer += chunk
    const events: ServerSentEvent[] = []
    let separator = this.buffer.match(/\r?\n\r?\n/)

    while (separator?.index !== undefined) {
      const block = this.buffer.slice(0, separator.index)
      this.buffer = this.buffer.slice(separator.index + separator[0].length)
      const parsed = parseEventBlock(block)
      if (parsed) events.push(parsed)
      separator = this.buffer.match(/\r?\n\r?\n/)
    }

    return events
  }

  flush(): ServerSentEvent[] {
    if (!this.buffer.trim()) {
      this.buffer = ""
      return []
    }

    const parsed = parseEventBlock(this.buffer)
    this.buffer = ""
    return parsed ? [parsed] : []
  }

  get pendingText() {
    return this.buffer
  }
}
