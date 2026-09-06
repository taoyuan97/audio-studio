import { HistoryOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Descriptions, List, Modal, Space, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { listArtifactVersions, restoreArtifactVersion } from '../../api/artifacts'
import { getConversation } from '../../api/conversations'
import type { Artifact, ScriptConfig } from '../../api/types'
import AudioPlayer from '../../components/AudioPlayer'
import WaveformView from '../../components/WaveformView'
import ScriptView from '../script-workspace/ScriptView'
import { ARTIFACT_TYPE_META, artifactParamRows, formatArtifactTime, formatSeconds } from './artifactMeta'

interface ArtifactDetailModalProps {
  artifact: Artifact | null
  scriptConfig?: ScriptConfig
  onClose: () => void
}

function downstreamOf(artifact: Artifact): { path: string; label: string } | null {
  if (artifact.type === 'script_meditation') return { path: `/tts?artifact_id=${artifact.id}`, label: '送去 TTS' }
  if (artifact.type === 'voice') return { path: `/mixdown?voice_id=${artifact.id}`, label: '送去混音' }
  if (artifact.type === 'bgm') return { path: `/mixdown?bgm_id=${artifact.id}`, label: '送去混音' }
  return null
}

export default function ArtifactDetailModal({ artifact, scriptConfig, onClose }: ArtifactDetailModalProps) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const isScript = artifact?.type === 'script_meditation'
  const versionsQuery = useQuery({
    queryKey: ['artifact-versions', artifact?.id],
    queryFn: () => listArtifactVersions(artifact!.id),
    enabled: Boolean(artifact && isScript),
  })
  const conversationQuery = useQuery({
    queryKey: ['conversation', artifact?.conversation_id],
    queryFn: () => getConversation(artifact!.conversation_id!),
    enabled: Boolean(artifact?.conversation_id && isScript),
  })
  const restoreMutation = useMutation({
    mutationFn: (versionId: string) => restoreArtifactVersion(
      artifact!.id,
      versionId,
      conversationQuery.data!.script_draft?.revision ?? 0,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', artifact?.conversation_id] })
      message.success('历史版本已恢复为工作草稿')
      onClose()
      navigate(`/meditation/${artifact!.conversation_id}`)
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', artifact?.conversation_id] })
      message.error('恢复失败，草稿可能已在其他页面更新')
    },
  })
  if (!artifact) return null
  const meta = ARTIFACT_TYPE_META[artifact.type]
  const downstream = downstreamOf(artifact)

  return (
    <Modal
      title="产物详情"
      open
      width={780}
      onCancel={onClose}
      footer={[
        downstream && <Button key="next" type="primary" onClick={() => navigate(downstream.path)}>{downstream.label}</Button>,
        <Button key="close" onClick={onClose}>关闭</Button>,
      ].filter(Boolean)}
      destroyOnHidden
    >
      <div className="library-detail">
        <Tag color={meta.color}>{meta.label}</Tag>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="名称">{artifact.name}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatArtifactTime(artifact.created_at)}</Descriptions.Item>
          {isScript && <Descriptions.Item label="当前版本">v{artifact.current_version_no ?? 1}</Descriptions.Item>}
          {artifact.audio && <Descriptions.Item label="实测时长">{formatSeconds(artifact.audio.duration)}</Descriptions.Item>}
          {artifactParamRows(artifact).map(([label, value]) => (
            <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>
          ))}
        </Descriptions>
        {isScript && artifact.content && <ScriptView content={artifact.content} scriptConfig={scriptConfig} />}
        {artifact.audio && (
          <div className="library-audio-detail">
            <WaveformView artifactId={artifact.id} />
            <AudioPlayer src={artifact.audio.url} label={artifact.name} />
          </div>
        )}
        {isScript && (
          <div>
            <Space><HistoryOutlined /><strong>版本历史</strong></Space>
            <List
              size="small"
              loading={versionsQuery.isLoading || conversationQuery.isLoading}
              dataSource={versionsQuery.data?.items ?? []}
              locale={{ emptyText: '暂无历史版本' }}
              renderItem={(version) => (
                <List.Item
                  actions={[
                    <Button
                      key="restore"
                      size="small"
                      disabled={!artifact.conversation_id || !conversationQuery.data || version.id === artifact.current_version_id}
                      loading={restoreMutation.isPending}
                      onClick={() => restoreMutation.mutate(version.id)}
                    >
                      {version.id === artifact.current_version_id ? '当前版本' : '恢复为草稿'}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta title={`v${version.version_no}`} description={formatArtifactTime(version.created_at)} />
                </List.Item>
              )}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
