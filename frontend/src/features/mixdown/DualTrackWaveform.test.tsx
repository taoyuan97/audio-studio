import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DualTrackWaveform from './DualTrackWaveform'

vi.mock('../../api/artifacts', () => ({
  getPeaks: vi.fn().mockResolvedValue({ peaks: [0.1, 0.5, 1], duration: 3, buckets: 3 }),
}))

describe('DualTrackWaveform', () => {
  afterEach(cleanup)
  it('renders stacked voice/background tracks and visual offset', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><DualTrackWaveform
      voice={{ id: 'voice', label: '人声', duration: 60 }}
      bgm={{ id: 'bgm', label: '背景', duration: 30 }}
      bgmOffset={5}
    /></QueryClientProvider>)
    expect(await screen.findByText('人声')).toBeInTheDocument()
    expect(screen.getByText('背景')).toBeInTheDocument()
    expect(screen.getByLabelText('背景偏移 5 秒')).toBeInTheDocument()
    expect(screen.getByLabelText('人声与背景双轨波形')).toBeInTheDocument()
  })
})
