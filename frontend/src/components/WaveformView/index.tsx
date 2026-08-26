import { useQuery } from '@tanstack/react-query'
import { Skeleton } from 'antd'
import { getPeaks } from '../../api/artifacts'

export default function WaveformView({ artifactId }: { artifactId: string }) {
  const query = useQuery({ queryKey: ['artifact-peaks', artifactId], queryFn: ({ signal }) => getPeaks(artifactId, signal) })
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 1 }} />
  if (!query.data?.peaks.length) return null
  const stride = Math.max(1, Math.ceil(query.data.peaks.length / 180))
  const bars = query.data.peaks.filter((_, index) => index % stride === 0)
  return <div className="waveform-view" role="img" aria-label="音频波形">
    {bars.map((peak, index) => <i key={index} style={{ height: `${Math.max(3, Math.round(peak * 100))}%` }} />)}
  </div>
}
