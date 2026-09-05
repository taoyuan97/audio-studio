import {
  AudioOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Space,
  Table,
  Tag,
} from 'antd'
import { useState } from 'react'
import {
  createTtsCustomVoice,
  deleteTtsCustomVoice,
  listTtsCustomVoices,
  renameTtsCustomVoice,
  verifyTtsCustomVoice,
} from '../../api/tts'
import { ApiError } from '../../api/client'
import type { CustomVoiceVerificationStatus, TtsCustomVoice } from '../../api/types'
import { suggestAliyunBasicVoiceId } from './form'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试'
}

function statusTag(status: CustomVoiceVerificationStatus) {
  if (status === 'verified') return <Tag color="success">已验证</Tag>
  if (status === 'failed') return <Tag color="error">验证失败</Tag>
  return <Tag>未验证</Tag>
}

function formatTime(value: number | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

export default function CustomVoiceSettings({ defaultModel }: { defaultModel: string }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [renaming, setRenaming] = useState<TtsCustomVoice | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [pendingCreate, setPendingCreate] = useState<{
    payload: { model: string; voice_id: string; name: string | null }
    suggestion: string
  } | null>(null)
  const [form] = Form.useForm<{ model: string; voice_id: string; name?: string }>()
  const query = useQuery({ queryKey: ['tts-custom-voices'], queryFn: () => listTtsCustomVoices() })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tts-custom-voices'] })
    queryClient.invalidateQueries({ queryKey: ['tts-defaults'] })
  }

  const createMutation = useMutation({
    mutationFn: createTtsCustomVoice,
    onSuccess: () => {
      refresh(); setCreateOpen(false); setPendingCreate(null); form.resetFields(); message.success('自定义音色已保存')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string | null }) => renameTtsCustomVoice(id, name),
    onSuccess: () => { refresh(); setRenaming(null); message.success('音色名称已更新') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteTtsCustomVoice,
    onSuccess: () => { refresh(); setPreviewSrc(null); message.success('本地音色配置已删除') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const verifyMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => verifyTtsCustomVoice(id, force),
    onSuccess: (result) => {
      refresh()
      setPreviewSrc(`${result.preview_url}?v=${result.voice.last_checked_at ?? result.voice.updated_at}`)
      message.success(result.cache_hit ? '正在播放试听缓存' : '音色验证成功')
    },
    onError: (error) => { refresh(); message.error(errorMessage(error)) },
  })

  const openCreate = () => {
    form.setFieldsValue({ model: defaultModel, voice_id: '', name: '' })
    setCreateOpen(true)
  }

  const submitCreate = (values: { model: string; voice_id: string; name?: string }) => {
    const payload = {
      model: values.model.trim(),
      voice_id: values.voice_id.trim(),
      name: values.name?.trim() || null,
    }
    const suggestion = suggestAliyunBasicVoiceId(payload.model, payload.voice_id)
    if (suggestion) {
      setPendingCreate({ payload, suggestion })
      return
    }
    createMutation.mutate(payload)
  }

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />

  const voices = query.data?.items ?? []
  return (
    <div className="settings-voice-stack">
      <Alert
        type="info"
        showIcon
        message="登记已有的阿里云音色"
        description="模型 ID 必须与音色匹配。保存本身不收费；首次试听和重新验证可能产生少量调用费用。删除仅影响 Audio Studio 本地记录，不会删除阿里云远端音色。"
      />
      <div className="settings-voice-toolbar">
        <div><strong>自定义音色</strong><span>共 {voices.length} 个</span></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增音色</Button>
      </div>
      {query.isError ? (
        <Card><Empty description="音色配置加载失败"><Button onClick={() => query.refetch()}>重新加载</Button></Empty></Card>
      ) : voices.length === 0 ? (
        <Card><Empty description="尚未配置自定义音色"><Button type="primary" onClick={openCreate}>新增音色</Button></Empty></Card>
      ) : (
        <Table<TtsCustomVoice>
          rowKey="id"
          pagination={false}
          dataSource={voices}
          scroll={{ x: 980 }}
          columns={[
            { title: '名称', dataIndex: 'display_name', width: 190, ellipsis: true },
            { title: '音色 ID', dataIndex: 'voice_id', width: 280, ellipsis: true },
            { title: '绑定模型', dataIndex: 'model', width: 230, ellipsis: true },
            {
              title: '状态', width: 120,
              render: (_, voice) => <Space direction="vertical" size={2}>{statusTag(voice.verification_status)}{voice.last_error && <span className="settings-voice-error" title={voice.last_error}>{voice.last_error}</span>}</Space>,
            },
            {
              title: '最近检查', width: 170,
              render: (_, voice) => <span title={`最近成功：${formatTime(voice.last_verified_at)}`}>{formatTime(voice.last_checked_at)}</span>,
            },
            {
              title: '操作', fixed: 'right', width: 330,
              render: (_, voice) => (
                <Space wrap>
                  <Button size="small" icon={<AudioOutlined />} loading={verifyMutation.isPending && verifyMutation.variables?.id === voice.id} onClick={() => verifyMutation.mutate({ id: voice.id, force: false })}>试听</Button>
                  <Popconfirm title="重新验证音色？" description="将绕过试听缓存并再次请求阿里云，可能产生少量费用。" okText="重新验证" cancelText="取消" onConfirm={() => verifyMutation.mutate({ id: voice.id, force: true })}>
                    <Button size="small" icon={<ReloadOutlined />}>重新验证</Button>
                  </Popconfirm>
                  <Button size="small" icon={<EditOutlined />} onClick={() => { setRenaming(voice); setRenameValue(voice.name ?? '') }}>重命名</Button>
                  <Popconfirm title="删除本地音色配置？" description="将删除本地记录和试听缓存，不会删除阿里云远端音色，也不影响历史产物。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteMutation.mutate(voice.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}
      {previewSrc && <Card size="small" title="试听"><audio className="settings-voice-preview" controls autoPlay src={previewSrc} onError={() => message.error('试听缓存加载失败')} /></Card>}

      <Modal title="新增阿里云音色" open={createOpen} okText="保存" cancelText="取消" confirmLoading={createMutation.isPending} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submitCreate}>
          <Form.Item name="model" label="模型 ID" rules={[{ required: true, whitespace: true, message: '请输入模型 ID' }, { pattern: IDENTIFIER_PATTERN, message: '仅支持字母、数字、点、下划线和连字符' }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="voice_id" label="音色 ID" extra="请填写 API 使用的完整 voice 参数；基础音色不能只填写试听文件名中的后缀。" rules={[{ required: true, whitespace: true, message: '请输入音色 ID' }, { pattern: IDENTIFIER_PATTERN, message: '仅支持字母、数字、点、下划线和连字符' }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="name" label="音色名称（可选）" rules={[{ max: 100, message: '名称不能超过 100 字符' }]}><Input maxLength={100} placeholder="留空时显示完整音色 ID" /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="检测到可能是基础音色后缀"
        open={pendingCreate !== null}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={pendingCreate ? [
          <Button key="back" onClick={() => setPendingCreate(null)}>返回修改</Button>,
          <Button key="raw" onClick={() => createMutation.mutate(pendingCreate.payload)}>按原 ID 保存</Button>,
          <Button key="complete" type="primary" loading={createMutation.isPending} onClick={() => createMutation.mutate({ ...pendingCreate.payload, voice_id: pendingCreate.suggestion })}>补全并保存</Button>,
        ] : null}
      >
        <p>阿里云基础音色需要包含模型前缀的完整 voice 参数。建议保存为：</p>
        <code className="settings-voice-suggestion">{pendingCreate?.suggestion}</code>
        <p>如果这是命名规则不同的声音复刻音色，可以选择“按原 ID 保存”。</p>
      </Modal>

      <Modal title="重命名音色" open={renaming !== null} okText="保存" cancelText="取消" confirmLoading={renameMutation.isPending} onCancel={() => setRenaming(null)} onOk={() => renaming && renameMutation.mutate({ id: renaming.id, name: renameValue.trim() || null })} destroyOnHidden>
        <Input value={renameValue} maxLength={100} placeholder="留空时显示完整音色 ID" onChange={(event) => setRenameValue(event.target.value)} />
      </Modal>
    </div>
  )
}
