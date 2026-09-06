import { useEffect, useRef, useState } from 'react'
import { App, Input, Modal, Radio } from 'antd'
import type { ScriptVersion } from '../../api/types'
import {
  buildDefaultExportTitle,
  exportScriptFile,
  validateExportTitle,
  type ScriptExportFormat,
} from './exportFile'

interface ExportScriptModalProps {
  open: boolean
  artifactName: string
  version: ScriptVersion | null
  onCancel: () => void
  onExported: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请稍后重试'
}

export default function ExportScriptModal({
  open,
  artifactName,
  version,
  onCancel,
  onExported,
}: ExportScriptModalProps) {
  const { message } = App.useApp()
  const wasOpen = useRef(false)
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<ScriptExportFormat>('markdown')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (open && !wasOpen.current) {
      setTitle(version ? buildDefaultExportTitle(artifactName, version.version_no, new Date()) : '')
      setFormat('markdown')
      setTitleError(null)
    }
    wasOpen.current = open
  }, [artifactName, open, version])

  const handleExport = async () => {
    if (exporting) return
    if (!version) {
      message.error('请选择要导出的版本')
      return
    }
    const validationError = validateExportTitle(title)
    setTitleError(validationError)
    if (validationError) return

    setExporting(true)
    try {
      const result = await exportScriptFile({
        title: title.trim(),
        scriptText: version.content.text,
        format,
      })
      if (result === 'cancelled') return
      if (result === 'downloaded') {
        message.info('当前浏览器不支持选择保存路径，文件已保存到浏览器下载目录')
      } else {
        message.success('脚本文档已导出')
      }
      onExported()
    } catch (error) {
      message.error(`导出失败：${errorMessage(error)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title="导出文件"
      open={open}
      onCancel={exporting ? undefined : onCancel}
      onOk={handleExport}
      okText="导出"
      cancelText="取消"
      confirmLoading={exporting}
      okButtonProps={{ disabled: !version }}
      cancelButtonProps={{ disabled: exporting }}
      closable={!exporting}
      maskClosable={!exporting}
      keyboard={!exporting}
      destroyOnHidden
    >
      <div className="script-export-form">
        <div className="script-export-version">脚本版本：v{version?.version_no ?? '-'}</div>
        <div className="script-export-field">
          <label htmlFor="script-export-title">文件标题</label>
          <Input
            id="script-export-title"
            value={title}
            maxLength={100}
            status={titleError ? 'error' : undefined}
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? 'script-export-title-error' : undefined}
            disabled={exporting}
            onChange={(event) => {
              setTitle(event.target.value.replace(/[\r\n]/g, ''))
              if (titleError) setTitleError(null)
            }}
            onPressEnter={() => void handleExport()}
          />
          {titleError && (
            <span id="script-export-title-error" className="script-export-error" role="alert">
              {titleError}
            </span>
          )}
        </div>
        <div className="script-export-field">
          <span className="script-export-label">导出格式</span>
          <Radio.Group
            aria-label="导出格式"
            value={format}
            disabled={exporting}
            onChange={(event) => setFormat(event.target.value as ScriptExportFormat)}
          >
            <Radio value="markdown">Markdown 文档（.md）</Radio>
            <Radio value="txt">TXT 文本（.txt）</Radio>
          </Radio.Group>
        </div>
        <p className="script-export-hint">点击导出后，可在系统窗口中选择保存位置和文件名。</p>
      </div>
    </Modal>
  )
}
