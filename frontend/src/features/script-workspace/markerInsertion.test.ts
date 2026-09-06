import { describe, expect, it } from 'vitest'
import { insertAtSelection } from './markerInsertion'

describe('insertAtSelection', () => {
  it('inserts at the caret and moves the caret after the marker', () => {
    expect(insertAtSelection('前后', { start: 1, end: 1 }, '[emotion:asmr]')).toEqual({
      text: '前[emotion:asmr]后',
      selection: { start: 15, end: 15 },
    })
  })

  it('keeps selected text and inserts before it', () => {
    expect(insertAtSelection('一段正文', { start: 2, end: 4 }, '[停顿 5s]')).toEqual({
      text: '一段[停顿 5s]正文',
      selection: { start: 9, end: 9 },
    })
  })
})
