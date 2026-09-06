import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDefaultExportTitle,
  buildExportContent,
  buildExportFileName,
  exportScriptFile,
  sanitizeExportFileName,
  validateExportTitle,
} from './exportFile'

type WindowWithPicker = typeof window & { showSaveFilePicker?: unknown }

afterEach(() => {
  delete (window as WindowWithPicker).showSaveFilePicker
  vi.restoreAllMocks()
})

describe('脚本文档导出纯函数', () => {
  it('按本地时间生成补零后的默认标题', () => {
    expect(buildDefaultExportTitle('睡前放松冥想', 2, new Date(2026, 8, 6, 9, 7))).toBe(
      '睡前放松冥想-v2-0906-0907',
    )
  })

  it('校验 trim 后标题、换行和字符数', () => {
    expect(validateExportTitle('  标题  ')).toBeNull()
    expect(validateExportTitle('   ')).toBe('请输入文件标题')
    expect(validateExportTitle('第一行\n第二行')).toBe('文件标题不能包含换行')
    expect(validateExportTitle('长'.repeat(101))).toBe('文件标题不能超过 100 个字符')
    expect(validateExportTitle('***')).toBe('文件标题不能生成有效的文件名')
  })

  it('清理 Windows 非法字符、ASCII 控制字符及末尾句点', () => {
    expect(sanitizeExportFileName('  睡前<>:"/\\|?*\u0001  放松...  ')).toBe('睡前 放松')
    expect(buildExportFileName('标题.md', 'markdown')).toBe('标题.md.md')
    expect(buildExportFileName('标题.txt', 'txt')).toBe('标题.txt.txt')
  })

  it('构建 Markdown/TXT，并保持正文内部空白和标签且统一结尾 LF', () => {
    const script = '[emotion:asmr]\r\n  慢慢呼吸  \n\n[vocal:sighing]\n[停顿 5s]\r\n\r\n'
    expect(buildExportContent('  睡前冥想  ', script, 'markdown')).toBe(
      '# 睡前冥想\n\n[emotion:asmr]\r\n  慢慢呼吸  \n\n[vocal:sighing]\n[停顿 5s]\n',
    )
    expect(buildExportContent('睡前冥想', '[吸气]\n[呼气]', 'txt')).toBe(
      '睡前冥想\n\n[吸气]\n[呼气]\n',
    )
  })
})

describe('exportScriptFile', () => {
  it('通过系统文件选择器写入无 BOM 的 UTF-8 Markdown Blob', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    })
    ;(window as WindowWithPicker).showSaveFilePicker = showSaveFilePicker

    await expect(
      exportScriptFile({ title: '测试脚本', scriptText: '[情绪:温柔]', format: 'markdown' }),
    ).resolves.toBe('saved')
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: '测试脚本.md',
      types: [{ description: 'Markdown 文档', accept: { 'text/markdown': ['.md'] } }],
    })
    const blob = write.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    expect(await blob.text()).toBe('# 测试脚本\n\n[情绪:温柔]\n')
    expect(new Uint8Array(await blob.arrayBuffer())[0]).not.toBe(0xef)
    expect(close).toHaveBeenCalledOnce()
  })

  it('将系统保存取消视为正常取消', async () => {
    ;(window as WindowWithPicker).showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('取消', 'AbortError'))
    await expect(
      exportScriptFile({ title: '脚本', scriptText: '正文', format: 'txt' }),
    ).resolves.toBe('cancelled')
  })

  it('回退下载 TXT 并始终移除链接、回收 Object URL', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:script-download')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await expect(
      exportScriptFile({ title: '纯文本', scriptText: '[语速:慢速]', format: 'txt' }),
    ).resolves.toBe('downloaded')
    expect(click).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/plain;charset=utf-8')
    expect(await blob.text()).toBe('纯文本\n\n[语速:慢速]\n')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:script-download')
    expect(document.querySelector('a[download]')).not.toBeInTheDocument()
  })

  it('下载点击失败时仍清理临时资源并向上抛错', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValue('blob:failed-download'),
    })
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('下载失败')
    })

    await expect(
      exportScriptFile({ title: '脚本', scriptText: '正文', format: 'txt' }),
    ).rejects.toThrow('下载失败')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed-download')
    expect(document.querySelector('a[download]')).not.toBeInTheDocument()
  })
})
