import { useEffect, useRef, useState } from 'react'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00'
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export interface AudioPlayerProps { src: string; label?: string }

export default function AudioPlayer({ src, label = '音频结果' }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  useEffect(() => { setCurrent(0); setDuration(0); audioRef.current?.load() }, [src])
  return (
    <div className="audio-player">
      <div className="audio-player-meta"><span>{label}</span><span>{formatTime(current)} / {formatTime(duration)}</span></div>
      <audio ref={audioRef} controls preload="metadata" src={src} aria-label={`${label}播放器`}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}>
        当前浏览器不支持音频播放。
      </audio>
    </div>
  )
}
