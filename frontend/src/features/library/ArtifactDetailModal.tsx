import { Button, Descriptions, Modal, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { Artifact } from '../../api/types'
import AudioPlayer from '../../components/AudioPlayer'
import WaveformView from '../../components/WaveformView'
import ScriptView from '../script-workspace/ScriptView'
import { ARTIFACT_TYPE_META, artifactParamRows, formatArtifactTime, formatSeconds } from './artifactMeta'

interface ArtifactDetailModalProps {
  artifact: Artifact | null
  onClose: () => void
}

export default function ArtifactDetailModal({ artifact, onClose }: ArtifactDetailModalProps) {
  const navigate = useNavigate()
  if (!artifact) return null
  const meta = ARTIFACT_TYPE_META[artifact.type]
  const isScript = artifact.type === 'script_meditation'

  const sendDownstream = () => {
    navigate(isScript ? `/tts?artifact_id=${artifact.id}` : `/mixdown?voice_id=${artifact.id}`)
  }

  return (
    <Modal
      title="产物详情"
      open
      width={760}
      onCancel={onClose}
      footer={[
        <Button key="next" type="primary" onClick={sendDownstream}>
          {isScript ? '送去 TTS' : '送去混音'}
        </Button>,
        <Button key="close" onClick={onClose}>关闭</Button>,
      ]}
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
        {isScript && artifact.content && <ScriptView content={artifact.content} />}
        {artifact.type === 'voice' && artifact.audio && (
          <div className="library-audio-detail">
            <WaveformView artifactId={artifact.id} />
            <AudioPlayer src={artifact.audio.url} label={artifact.name} />
          </div>
        )}
      </div>
    </Modal>
  )
}
