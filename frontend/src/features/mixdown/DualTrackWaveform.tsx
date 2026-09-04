import { useQuery } from '@tanstack/react-query'
import { Empty, Skeleton } from 'antd'
import { getPeaks } from '../../api/artifacts'

interface Track {
  id: string
  label: string
  duration: number
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
}: {
  voice: Track | null
  bgm: Track | null
  bgmOffset: number
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

  const totalDuration = Math.max(voice?.duration ?? 0, (bgm?.duration ?? 0) + (bgm ? bgmOffset : 0), 1)
  const offsetPercent = Math.min(100, (bgmOffset / totalDuration) * 100)
  return <div className="mix-waveforms" role="img" aria-label="人声与背景双轨波形">
    {voice && <div className="mix-waveform-row">
      <span>{voice.label}</span>
      <div className="mix-waveform-bars voice"><TrackBars peaks={voiceQuery.data?.peaks ?? []} /></div>
    </div>}
    {bgm && <div className="mix-waveform-row">
      <span>{bgm.label}</span>
      <div className="mix-waveform-timeline">
        {offsetPercent > 0 && <b aria-label={`背景偏移 ${bgmOffset} 秒`} style={{ width: `${offsetPercent}%` }} />}
        <div className="mix-waveform-bars bgm"><TrackBars peaks={bgmQuery.data?.peaks ?? []} /></div>
      </div>
    </div>}
  </div>
}
