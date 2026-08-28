import { describe, expect, it } from 'vitest'
import {
  attachmentKey,
  formatFileSize,
  mergeSelectedFiles,
  type PendingAttachment,
} from './attachments'

function fakeFile(
  name: string,
  bytes: number[],
  options: { size?: number; lastModified?: number } = {},
): File {
  const buffer = Uint8Array.from(bytes).buffer
  return {
    name,
    size: options.size ?? bytes.length,
    lastModified: options.lastModified ?? 1,
    arrayBuffer: async () => buffer,
  } as File
}

describe('message attachments', () => {
  it('strictly decodes UTF-8, strips BOM and accepts md/txt', async () => {
    const file = fakeFile('参考.md', [0xef, 0xbb, 0xbf, ...new TextEncoder().encode('正文')])
    const result = await mergeSelectedFiles([], [file])

    expect(result.errors).toEqual([])
    expect(result.accepted[0]).toMatchObject({ name: '参考.md', content: '正文' })
  })

  it('rejects invalid encoding/type and keeps valid partial selection', async () => {
    const valid = fakeFile('ok.txt', [...new TextEncoder().encode('hello')])
    const invalidEncoding = fakeFile('gbk.txt', [0xc4, 0xe3, 0xba, 0xc3])
    const invalidType = fakeFile('note.pdf', [1])
    const result = await mergeSelectedFiles([], [valid, invalidEncoding, invalidType])

    expect(result.accepted.map((item) => item.name)).toEqual(['ok.txt'])
    expect(result.errors.join(' ')).toContain('UTF-8')
    expect(result.errors.join(' ')).toContain('仅支持')
  })

  it('deduplicates exact file metadata while allowing same-name variants', async () => {
    const first = fakeFile('same.txt', [65], { lastModified: 1 })
    const variant = fakeFile('same.txt', [66], { lastModified: 2 })
    const current: PendingAttachment[] = [
      { key: attachmentKey(first), name: first.name, size: first.size, lastModified: 1, content: 'A' },
    ]
    const result = await mergeSelectedFiles(current, [first, variant])

    expect(result.accepted).toHaveLength(2)
    expect(result.errors[0]).toContain('已在待发送列表中')
  })

  it('limits the list to three and formats byte sizes', async () => {
    const files = [1, 2, 3, 4].map((value) =>
      fakeFile(`${value}.txt`, [65], { lastModified: value }),
    )
    const result = await mergeSelectedFiles([], files)

    expect(result.accepted).toHaveLength(3)
    expect(result.errors[0]).toContain('最多 3 个')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })
})
