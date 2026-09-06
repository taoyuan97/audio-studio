export interface SelectionRange {
  start: number
  end: number
}

export function insertAtSelection(text: string, selection: SelectionRange, marker: string) {
  const start = Math.max(0, Math.min(selection.start, text.length))
  const next = `${text.slice(0, start)}${marker}${text.slice(start)}`
  const cursor = start + marker.length
  return { text: next, selection: { start: cursor, end: cursor } }
}
