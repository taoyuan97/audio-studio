import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import AudioPlayer from '.'

beforeAll(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})

describe('AudioPlayer', () => {
  it('渲染音频地址并更新时间显示', () => {
    render(<AudioPlayer src="/api/artifacts/art_1/audio" label="测试人声" />)
    const audio = screen.getByLabelText('测试人声播放器') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 65 })
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 5 })
    fireEvent.loadedMetadata(audio)
    fireEvent.timeUpdate(audio)
    expect(audio.getAttribute('src')).toBe('/api/artifacts/art_1/audio')
    expect(screen.getByText('00:05 / 01:05')).toBeInTheDocument()
  })
})
