import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  LockOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Form, Input, InputNumber, Popconfirm, Skeleton, Space, Switch, Tabs, Tag } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  clearProviderCredentials,
  getSettingsStatus,
  probeProvider,
  revealProviderCredential,
  updateProvider,
  updateRuntime,
} from '../api/settings'
import { ApiError } from '../api/client'
import type { ProviderStatus, SettingsProviderId, SettingsStatus } from '../api/types'
import CustomVoiceSettings from '../features/tts/CustomVoiceSettings'
import ScriptConfigSettings from '../features/settings/ScriptConfigSettings'

const PROVIDERS: Array<{ id: SettingsProviderId; title: string; kind: string; model?: boolean }> = [
  { id: 'llm_deepseek', title: 'DeepSeek', kind: 'LLM', model: true },
  { id: 'llm_qwen', title: '通义千问', kind: 'LLM', model: true },
  { id: 'llm_moonshot', title: 'Kimi', kind: 'LLM', model: true },
  { id: 'tts_aliyun', title: '阿里云 TTS', kind: 'TTS', model: true },
  { id: 'tts_volc', title: '火山引擎 TTS', kind: 'TTS' },
  { id: 'minimax', title: 'MiniMax Music', kind: 'BGM', model: true },
]

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试'
}

function sourceLabel(source: ProviderStatus['credential_source']): string {
  return source === 'runtime' ? '浏览器配置' : source === 'env' ? '.env' : source === 'mixed' ? '混合来源' : '未配置'
}

function moonshotThinkingCapability(model: string | undefined) {
  const normalized = model?.trim().toLowerCase() ?? ''
  if (normalized === 'kimi-k2.5' || normalized === 'kimi-k2.6') {
    return { configurable: true, reason: null }
  }
  if (normalized === 'kimi-k2.7-code' || normalized === 'kimi-k2.7-code-highspeed') {
    return { configurable: false, reason: 'Kimi K2.7 Code 始终开启思考，不能关闭' }
  }
  if (normalized === 'kimi-k3') {
    return { configurable: false, reason: 'Kimi K3 不使用 thinking 开关' }
  }
  return { configurable: false, reason: '当前模型不支持可配置的思考模式' }
}

interface ProviderFormValues {
  model_id?: string
  thinking_enabled?: boolean
}

function ProviderCard({
  id, title, kind, hasModel, status, revision,
}: {
  id: SettingsProviderId
  title: string
  kind: string
  hasModel: boolean
  status: ProviderStatus
  revision: number
}) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const watchedModel = Form.useWatch<string>('model_id', form) ?? status.model_id
  const thinkingCapability = moonshotThinkingCapability(watchedModel)
  const [credential, setCredential] = useState('')
  const [credentialDirty, setCredentialDirty] = useState(false)
  const [credentialVisible, setCredentialVisible] = useState(false)
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [appId, setAppId] = useState('')
  const [appIdDirty, setAppIdDirty] = useState(false)
  const [accessToken, setAccessToken] = useState('')
  const [accessTokenDirty, setAccessTokenDirty] = useState(false)
  const [accessTokenVisible, setAccessTokenVisible] = useState(false)
  const [accessTokenLoading, setAccessTokenLoading] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['settings-status'] })
  const revealable = (field: 'credential' | 'app_id' | 'access_token') =>
    status.runtime_credential_fields.includes(field)

  useEffect(() => {
    if (id !== 'tts_volc' || !status.runtime_credential_fields.includes('app_id')) return
    let active = true
    revealProviderCredential(id, revision, 'app_id').then((result) => {
      if (active) setAppId(result.value)
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'SETTINGS_REVISION_CONFLICT') {
        queryClient.invalidateQueries({ queryKey: ['settings-status'] })
      }
      if (active) message.error(`${title} App ID 查看失败：${errorMessage(error)}`)
    })
    return () => { active = false }
  }, [id, message, queryClient, revision, status.runtime_credential_fields, title])

  const showSecret = async (field: 'credential' | 'access_token') => {
    const current = field === 'credential' ? credential : accessToken
    if (current) {
      if (field === 'credential') setCredentialVisible(true)
      else setAccessTokenVisible(true)
      return
    }
    if (!revealable(field)) return
    const setLoading = field === 'credential' ? setCredentialLoading : setAccessTokenLoading
    setLoading(true)
    try {
      const result = await revealProviderCredential(id, revision, field)
      if (field === 'credential') {
        setCredential(result.value)
        setCredentialVisible(true)
      } else {
        setAccessToken(result.value)
        setAccessTokenVisible(true)
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SETTINGS_REVISION_CONFLICT') refresh()
      message.error(`${title} ${field === 'credential' ? 'API Key' : 'Access Token'} 查看失败：${errorMessage(error)}`)
    } finally {
      setLoading(false)
    }
  }
  const saveMutation = useMutation({
    mutationFn: (values: ProviderFormValues) => {
      const payload: {
        revision: number
        credential?: string
        model_id?: string
        app_id?: string
        access_token?: string
        thinking_enabled?: boolean
      } = { revision }
      if (hasModel) payload.model_id = values.model_id
      if (id === 'llm_moonshot') payload.thinking_enabled = values.thinking_enabled
      if (id === 'tts_volc') {
        if (appIdDirty) payload.app_id = appId
        if (accessTokenDirty) payload.access_token = accessToken
      } else if (credentialDirty) {
        payload.credential = credential
      }
      return updateProvider(id, payload)
    },
    onSuccess: () => {
      form.setFieldsValue({ credential: '', app_id: '', access_token: '' })
      setCredential(''); setCredentialDirty(false); setCredentialVisible(false)
      setAppId(''); setAppIdDirty(false)
      setAccessToken(''); setAccessTokenDirty(false); setAccessTokenVisible(false)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['tts-defaults'] })
      queryClient.invalidateQueries({ queryKey: ['music-defaults'] })
      message.success(`${title} 配置已保存并生效`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'SETTINGS_REVISION_CONFLICT') refresh()
      message.error(errorMessage(error))
    },
  })
  const clearMutation = useMutation({
    mutationFn: () => clearProviderCredentials(id, revision),
    onSuccess: () => {
      refresh()
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['tts-defaults'] })
      queryClient.invalidateQueries({ queryKey: ['music-defaults'] })
      message.success(`${title} ${id === 'tts_volc' ? '浏览器认证信息已清除' : '浏览器 API Key 已清除'}`)
    },
    onError: (error) => { refresh(); message.error(errorMessage(error)) },
  })
  const probeMutation = useMutation({
    mutationFn: () => probeProvider(id),
    onSuccess: (result) => result.ok ? message.success(`${title}：${result.message}`) : message.error(`${title}：${result.message}`),
    onError: (error) => message.error(errorMessage(error)),
  })

  let credentialFields: ReactNode = null
  if (status.editable && id === 'tts_volc') {
    credentialFields = (
      <>
        <Form.Item label="App ID">
          <Input
            aria-label="火山 TTS App ID"
            value={appId}
            placeholder={revealable('app_id') ? '正在读取浏览器保存的 App ID…' : '来自 .env 时不可查看；输入新值可覆盖'}
            autoComplete="off"
            onChange={(event) => { setAppId(event.target.value); setAppIdDirty(true) }}
          />
        </Form.Item>
        <Form.Item label="Access Token">
          <Input.Password
            aria-label="火山 TTS Access Token"
            value={accessToken}
            placeholder={revealable('access_token') ? '已保存，点击眼睛查看' : '来自 .env 时不可查看；输入新值可覆盖'}
            autoComplete="new-password"
            disabled={accessTokenLoading}
            visibilityToggle={revealable('access_token') || Boolean(accessToken) ? {
              visible: accessTokenVisible,
              onVisibleChange: (visible) => visible ? void showSecret('access_token') : setAccessTokenVisible(false),
            } : false}
            onChange={(event) => { setAccessToken(event.target.value); setAccessTokenDirty(true) }}
          />
        </Form.Item>
      </>
    )
  } else if (status.editable) {
    credentialFields = (
      <Form.Item label="API Key">
        <Input.Password
          aria-label={`${title} API Key`}
          value={credential}
          placeholder={revealable('credential') ? `${status.credential_masked ?? '已保存'}，点击眼睛查看` : '来自 .env 时不可查看；输入新值可覆盖'}
          autoComplete="new-password"
          disabled={credentialLoading}
          visibilityToggle={revealable('credential') || Boolean(credential) ? {
            visible: credentialVisible,
            onVisibleChange: (visible) => visible ? void showSecret('credential') : setCredentialVisible(false),
          } : false}
          onChange={(event) => { setCredential(event.target.value); setCredentialDirty(true) }}
        />
      </Form.Item>
    )
  }

  return (
    <Card
      className="settings-provider-card"
      title={<Space><span>{title}</span><Tag>{kind}</Tag></Space>}
      extra={status.configured ? <Tag color="success" icon={<CheckCircleOutlined />}>已配置</Tag> : <Tag color="error" icon={<CloseCircleOutlined />}>未配置</Tag>}
    >
      <div className="settings-meta">
        <span><LockOutlined /> {status.credential_masked ?? (id === 'tts_volc' ? '无认证信息' : '无 API Key')}</span>
        <Tag>{sourceLabel(status.credential_source)}</Tag>
      </div>
      {status.editable ? (
        <Form
          form={form}
          name={id}
          layout="vertical"
          initialValues={{
            model_id: status.model_id,
            thinking_enabled: status.thinking_enabled ?? true,
          }}
          onFinish={(values) => saveMutation.mutate(values)}
        >
          {hasModel && <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, whitespace: true, message: '请输入模型 ID' }]}><Input /></Form.Item>}
          {id === 'llm_moonshot' && (
            <Form.Item
              name="thinking_enabled"
              label="深度思考"
              valuePropName="checked"
              extra={thinkingCapability.configurable
                ? '开启后模型会先推理再生成正文，耗时和 Token 消耗可能增加'
                : thinkingCapability.reason}
            >
              <Switch
                aria-label="Kimi 深度思考"
                checkedChildren="开启"
                unCheckedChildren="关闭"
                disabled={!thinkingCapability.configurable}
              />
            </Form.Item>
          )}
          {credentialFields}
          <Space wrap>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saveMutation.isPending}
              disabled={id === 'tts_volc' && !appIdDirty && !accessTokenDirty}
            >保存</Button>
            <Popconfirm
              title={id === 'tts_volc' ? '清除浏览器认证信息？' : '清除浏览器 API Key？'}
              description="清除后如 .env 有值将自动回退。"
              okText="清除"
              cancelText="取消"
              onConfirm={() => clearMutation.mutate()}
            >
              <Button danger disabled={status.credential_source !== 'runtime' && status.credential_source !== 'mixed'} loading={clearMutation.isPending}>
                {id === 'tts_volc' ? '清除认证信息' : '清除 API Key'}
              </Button>
            </Popconfirm>
            <Button icon={<ExperimentOutlined />} onClick={() => probeMutation.mutate()} loading={probeMutation.isPending}>测试连通</Button>
          </Space>
        </Form>
      ) : (
        <Space direction="vertical" size="middle">
          <Alert type="info" showIcon message="当前服务配置为只读。" />
          <Button icon={<ExperimentOutlined />} onClick={() => probeMutation.mutate()} loading={probeMutation.isPending}>测试连通</Button>
        </Space>
      )}
    </Card>
  )
}

function RuntimeCard({ status }: { status: SettingsStatus }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (values: SettingsStatus['runtime']) => updateRuntime({ revision: status.revision, ...values }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings-status'] }); message.success('超时参数已保存并生效') },
    onError: (error) => { queryClient.invalidateQueries({ queryKey: ['settings-status'] }); message.error(errorMessage(error)) },
  })
  return (
    <Card title="运行参数">
      <Form layout="vertical" initialValues={status.runtime} onFinish={(values) => mutation.mutate(values)}>
        <div className="settings-runtime-grid">
          <Form.Item name="llm_timeout_seconds" label="LLM 超时（秒）" rules={[{ required: true }]}><InputNumber min={1} max={600} /></Form.Item>
          <Form.Item name="minimax_timeout_seconds" label="MiniMax 超时（秒）" rules={[{ required: true }]}><InputNumber min={30} max={1200} /></Form.Item>
        </div>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={mutation.isPending}>保存运行参数</Button>
      </Form>
    </Card>
  )
}

export default function SettingsPage() {
  const { message } = App.useApp()
  const [activeTab, setActiveTab] = useState<'environment' | 'voices' | 'script'>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    return tab === 'voices' || tab === 'script' ? tab : 'environment'
  })
  const [scriptConfigDirty, setScriptConfigDirty] = useState(false)
  const query = useQuery({ queryKey: ['settings-status'], queryFn: ({ signal }) => getSettingsStatus(signal) })
  const ffmpegProbe = useMutation({
    mutationFn: () => probeProvider('ffmpeg'),
    onSuccess: (result) => result.ok ? message.success(result.message) : message.error(result.message),
    onError: (error) => message.error(errorMessage(error)),
  })
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />
  if (!query.data) return <Alert type="error" showIcon message="设置加载失败" action={<Button onClick={() => query.refetch()}>重试</Button>} />
  const status = query.data
  const changeTab = (key: string) => {
    const next = key === 'voices' || key === 'script' ? key : 'environment'
    if (activeTab === 'script' && next !== 'script' && scriptConfigDirty && !window.confirm('脚本配置尚未保存，确定离开吗？')) return
    setActiveTab(next)
    const url = new URL(window.location.href)
    if (next !== 'environment') url.searchParams.set('tab', next)
    else url.searchParams.delete('tab')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return (
    <div className="page-stack settings-page">
      <div className="page-head"><div><h2 className="page-title">设置</h2><p className="page-desc">管理模型、运行环境、脚本标签与阿里云 TTS 自定义音色。</p></div><Tag>配置版本 {status.revision}</Tag></div>
      <Alert type="warning" showIcon message="仅限本机可信用户" description="设置写入未提供登录鉴权，请保持服务绑定 127.0.0.1，不要暴露到局域网或公网。" />
      {status.fake_mode && <Alert type="info" showIcon message="当前为 FAKE_MODE" description="普通生成使用本地模拟；“测试连通”仍会请求真实第三方服务。" />}
      <Tabs
        activeKey={activeTab}
        onChange={changeTab}
        items={[
          {
            key: 'environment',
            label: '模型与环境设置',
            children: <div className="settings-tab-stack">
              <div className="settings-provider-grid">
                {PROVIDERS.map((provider) => (
                  <ProviderCard
                    key={`${provider.id}-${status.revision}`}
                    id={provider.id}
                    title={provider.title}
                    kind={provider.kind}
                    hasModel={Boolean(provider.model)}
                    status={status.providers[provider.id]}
                    revision={status.revision}
                  />
                ))}
              </div>
              <RuntimeCard key={`runtime-${status.revision}`} status={status} />
              <Card title="本地环境">
                <div className="settings-environment">
                  <span>FFmpeg：{status.ffmpeg.available ? '可用' : '不可用'}</span>
                  <span>ffprobe：{status.ffmpeg.ffprobe_available ? '可用' : '不可用'}</span>
                  <span className="settings-version">{status.ffmpeg.version ?? '未检测到版本'}</span>
                  <Button icon={<ExperimentOutlined />} loading={ffmpegProbe.isPending} onClick={() => ffmpegProbe.mutate()}>测试 FFmpeg</Button>
                </div>
              </Card>
            </div>,
          },
          {
            key: 'voices',
            label: '音色配置',
            children: <CustomVoiceSettings defaultModel={status.providers.tts_aliyun.model_id ?? 'qwen-audio-3.0-tts-plus'} />,
          },
          {
            key: 'script',
            label: '脚本配置',
            children: <ScriptConfigSettings onDirtyChange={setScriptConfigDirty} />,
          },
        ]}
      />
    </div>
  )
}
