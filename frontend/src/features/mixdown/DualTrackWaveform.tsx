import { useQuery } from '@tanstack/react-query'
import { Empty, Skeleton } from 'antd'
import { getPeaks } from '../../api/artifacts'

interface Track {
  id: string
  label: string
  duration: number
}

function adjustedDuration(track: Track | null, speed: number) {
  return (track?.duration ?? 0) / speed
}

function TrackBars({ peaks }: { peaks: number[] }) {
  const stride = Math.max(1, Math.ceil(peaks.length / 150))
  return peaks.filter((_, index) => index % stride === 0).map((peak, index) => (
    <i key={index} style={{ height: `${Math.max(3, Math.round(peak * 100))}%` }} />
  ))
}

export default function DualTrackWaveform({
  voice,
  bgm,
  bgmOffset,
  voiceSpeed,
  bgmSpeed,
}: {
  voice: Track | null
  bgm: Track | null
  bgmOffset: number
  voiceSpeed: number
  bgmSpeed: number
}) {
  const voiceQuery = useQuery({
    queryKey: ['artifact-peaks', voice?.id],
    queryFn: ({ signal }) => getPeaks(voice!.id, signal),
    enabled: Boolean(voice),
  })
  const bgmQuery = useQuery({
    queryKey: ['artifact-peaks', bgm?.id],
    queryFn: ({ signal }) => getPeaks(bgm!.id, signal),
    enabled: Boolean(bgm),
  })
  if (!voice && !bgm) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择音轨后显示双轨波形" />
  if ((voice && voiceQuery.isLoading) || (bgm && bgmQuery.isLoading)) return <Skeleton active paragraph={{ rows: 3 }} />

  const voiceDuration = adjustedDuration(voice, voiceSpeed)
  const bgmDuration = adjustedDuration(bgm, bgmSpeed)
  const totalDuration = Math.max(voice ? voiceDuration : bgmDuration, 1)
  const visibleOffset = voice && bgm ? bgmOffset : 0
  const offsetPercent = Math.min(100, (visibleOffset / totalDuration) * 100)
  const voicePercent = Math.min(100, (voiceDuration / totalDuration) * 100)
  const bgmPercent = voice && bgm ? Math.max(0, 100 - offsetPercent) : Math.min(100, (bgmDuration / totalDuration) * 100)
  return <div className="mix-waveforms" role="img" aria-label="人声与背景双轨波形">
    {voice && <div className="mix-waveform-row">
      <span><strong>{voice.label}</strong><small>{voiceDuration.toFixed(1)} 秒</small></span>
      <div className="mix-waveform-timeline"><div className="mix-waveform-bars voice" style={{ width: `${voicePercent}%` }}><TrackBars peaks={voiceQuery.data?.peaks ?? []} /></div></div>
    </div>}
    {bgm && <div className="mix-waveform-row">
      <span><strong>{bgm.label}</strong><small>{bgmDuration.toFixed(1)} 秒</small></span>
      <div className="mix-waveform-timeline">
        {offsetPercent > 0 && <b aria-label={`背景偏移 ${bgmOffset} 秒`} style={{ width: `${offsetPercent}%` }} />}
        <div className="mix-waveform-bars bgm" style={{ width: `${bgmPercent}%` }}><TrackBars peaks={bgmQuery.data?.peaks ?? []} /></div>
      </div>
    </div>}
  </div>
}
