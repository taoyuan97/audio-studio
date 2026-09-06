export type ScriptExportFormat = 'markdown' | 'txt'

export interface ExportScriptFileInput {
  title: string
  scriptText: string
  format: ScriptExportFormat
}

export type ExportScriptFileResult = 'saved' | 'downloaded' | 'cancelled'

interface WritableFileHandle {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>
    close: () => Promise<void>
  }>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{
    description?: string
    accept: Record<string, string[]>
  }>
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<WritableFileHandle>

const FORMAT_META: Record<
  ScriptExportFormat,
  { extension: '.md' | '.txt'; blobMimeType: string; pickerMimeType: string; description: string }
> = {
  markdown: {
    extension: '.md',
    blobMimeType: 'text/markdown;charset=utf-8',
    pickerMimeType: 'text/markdown',
    description: 'Markdown 文档',
  },
  txt: {
    extension: '.txt',
    blobMimeType: 'text/plain;charset=utf-8',
    pickerMimeType: 'text/plain',
    description: 'TXT 文本',
  },
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function buildDefaultExportTitle(
  artifactName: string,
  versionNumber: number,
  now: Date,
): string {
  return `${artifactName}-v${versionNumber}-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

export function validateExportTitle(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) return '请输入文件标题'
  if (/\r|\n/.test(title)) return '文件标题不能包含换行'
  if (Array.from(trimmed).length > 100) return '文件标题不能超过 100 个字符'
  if (!sanitizeExportFileName(trimmed)) return '文件标题不能生成有效的文件名'
  return null
}

export function sanitizeExportFileName(title: string): string {
  return Array.from(title.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || '<>:"/\\|?*'.includes(character) ? ' ' : character
  })
    .join('')
    .replace(/ +/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

export function buildExportFileName(title: string, format: ScriptExportFormat): string {
  const baseName = sanitizeExportFileName(title)
  if (!baseName) throw new Error('文件标题不能生成有效的文件名')
  return `${baseName}${FORMAT_META[format].extension}`
}

export function buildExportContent(
  title: string,
  scriptText: string,
  format: ScriptExportFormat,
): string {
  const documentTitle = title.trim()
  const body = scriptText.replace(/[\r\n]+$/g, '')
  const heading = format === 'markdown' ? `# ${documentTitle}` : documentTitle
  return `${heading}\n\n${body}\n`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

/** 优先使用系统“另存为”；能力不可用时回退为浏览器下载。 */
export async function exportScriptFile(
  input: ExportScriptFileInput,
): Promise<ExportScriptFileResult> {
  const titleError = validateExportTitle(input.title)
  if (titleError) throw new Error(titleError)

  const meta = FORMAT_META[input.format]
  const fileName = buildExportFileName(input.title, input.format)
  const content = buildExportContent(input.title, input.scriptText, input.format)
  const blob = new Blob([content], { type: meta.blobMimeType })
  const picker = (
    window as typeof window & {
      showSaveFilePicker?: SaveFilePicker
    }
  ).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: fileName,
        types: [
          {
            description: meta.description,
            accept: { [meta.pickerMimeType]: [meta.extension] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (error) {
      if (isAbortError(error)) return 'cancelled'
      throw error
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(objectUrl)
  }
  return 'downloaded'
}
