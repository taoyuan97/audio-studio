import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8010'

type RunState = {
  run_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  queue_position: number
  artifact_id: string | null
}

async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`HTTP ${response.status()}: ${await response.text()}`)
  return response.json() as Promise<T>
}

async function waitForRun(
  request: APIRequestContext,
  runId: string,
  statuses: RunState['status'][],
): Promise<RunState> {
  let latest: RunState | undefined
  await expect.poll(async () => {
    latest = await json<RunState>(await request.get(`${API}/api/runs/${runId}`))
    if (['failed', 'cancelled'].includes(latest.status) && !statuses.includes(latest.status)) {
      throw new Error(`run ${runId} unexpectedly ended: ${JSON.stringify(latest)}`)
    }
    return statuses.includes(latest.status)
  }, { timeout: 60_000 }).toBe(true)
  return latest!
}

async function armRun(
  request: APIRequestContext,
  payload: {
    kind: 'script' | 'tts' | 'music' | 'mixdown'
    delay_seconds?: number
    failure_code?: string
    failure_message?: string
    download_available?: boolean
  },
): Promise<void> {
  const response = await request.post(`${API}/api/_e2e/run-control`, { data: payload })
  expect(response.ok(), await response.text()).toBeTruthy()
}

async function ttsDefaults(request: APIRequestContext) {
  return json<{
    engines: Array<{ id: string; voices: Array<{ id: string }> }>
    scene_presets: { meditation: { speed: number } }
  }>(await request.get(`${API}/api/tts/defaults`))
}

async function submitTts(request: APIRequestContext, text: string) {
  const defaults = await ttsDefaults(request)
  const engine = defaults.engines[0]
  expect(engine?.voices[0]).toBeTruthy()
  return json<{ run_id: string }>(await request.post(`${API}/api/tts/jobs`, {
    data: {
      script_artifact_id: null,
      text,
      scene: 'meditation',
      engine: engine!.id,
      voice_id: engine!.voices[0].id,
      speed: defaults.scene_presets.meditation.speed,
      pitch: null,
      format: 'wav',
    },
  }))
}

async function submitBgm(request: APIRequestContext, prompt: string) {
  const run = await json<{ run_id: string }>(await request.post(`${API}/api/music/jobs`, {
    data: {
      prompt,
      target_duration: 60,
      structure_hints: ['intro', 'outro'],
      format: 'wav',
    },
  }))
  const completed = await waitForRun(request, run.run_id, ['completed'])
  const artifact = await json<{ id: string; name: string }>(
    await request.get(`${API}/api/artifacts/${completed.artifact_id}`),
  )
  return artifact
}

async function setMinimumDuration(page: Page): Promise<void> {
  const slider = page.getByRole('slider')
  await slider.focus()
  await slider.press('Home')
  await expect(page.getByText('目标时长').locator('..')).toContainText('1 分钟')
}

async function chooseWav(page: Page): Promise<void> {
  await page.locator('label.ant-radio-button-wrapper').filter({ hasText: 'WAV' }).click()
}

test.describe.serial('T008 quality delivery', () => {
  test('主路径 A：冥想脚本编辑、TTS、真实双轨混音、产物播放', async ({ page, request }) => {
    const bgm = await submitBgm(request, 'E2E 双轨混音背景，轻柔稳定')

    await page.goto('/meditation')
    await page.getByRole('button', { name: '新建会话' }).click()
    const composer = page.getByPlaceholder(/描述你想要的冥想主题/)
    await composer.fill('生成一段简短的睡前放松练习')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.getByText('生成结果', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '编辑脚本' }).click()
    await page.locator('.script-edit').fill('请闭上眼睛。[停顿 1s][情绪:温柔]慢慢呼吸。[吸气][呼气]现在放松下来。')
    await page.getByRole('button', { name: '完成编辑' }).click()
    await page.getByRole('button', { name: '保存脚本' }).click()
    await page.getByLabel('脚本名称').fill('E2E 冥想脚本')
    await page.getByRole('button', { name: '保存为 v1' }).click()
    await expect(page.getByRole('button', { name: '送去 TTS' })).toBeEnabled()
    await page.getByRole('button', { name: '送去 TTS' }).click()

    await expect(page).toHaveURL(/\/tts\?artifact_id=/)
    await chooseWav(page)
    await page.getByRole('button', { name: '开始合成人声' }).click()
    await expect(page.getByText('人声干声', { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '送去混音' }).click()

    await expect(page).toHaveURL(/\/mixdown\?voice_id=/)
    const bgmField = page.locator('.mix-field').filter({ hasText: '背景音轨' })
    await bgmField.locator('.ant-select-selector').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: bgm.name }).click()
    await chooseWav(page)
    await page.getByRole('button', { name: '开始混音' }).click()
    await expect(page.getByText('混音成品', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.mix-result audio')).toHaveAttribute('src', /\/api\/artifacts\/.+\/audio/)

    const mixes = await json<{ items: Array<{ id: string }> }>(
      await request.get(`${API}/api/artifacts`, { params: { type: 'mix', limit: 1 } }),
    )
    expect(mixes.items).toHaveLength(1)
    const range = await request.get(`${API}/api/artifacts/${mixes.items[0].id}/audio`, {
      headers: { Range: 'bytes=0-99' },
    })
    expect(range.status()).toBe(206)
    expect((await range.body()).byteLength).toBe(100)

    await page.getByRole('button', { name: '在产物库中查看' }).click()
    const libraryMix = page.locator('.library-card').first()
    await expect(libraryMix).toBeVisible()
    await expect(libraryMix).toContainText('成品')
    await libraryMix.getByRole('button', { name: '详情' }).click()
    await expect(page.getByRole('dialog').locator('audio')).toHaveAttribute(
      'src',
      /\/api\/artifacts\/.+\/audio/,
    )
  })

  test('主路径 B：BGM fake 生成后仅背景轨混音导出', async ({ page, request }) => {
    await page.goto('/bgm')
    await page.getByPlaceholder(/空灵缓慢的冥想背景音乐/).fill('E2E 纯音乐路径，古琴与环境音')
    await setMinimumDuration(page)
    await chooseWav(page)
    await page.getByRole('button', { name: '生成纯音乐' }).click()
    await expect(page.getByText('背景音乐', { exact: true })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: '送去混音' }).click()

    await expect(page).toHaveURL(/\/mixdown\?bgm_id=/)
    await expect(page.getByText(/仅背景/).first()).toBeVisible()
    await chooseWav(page)
    await page.getByRole('button', { name: '开始混音' }).click()
    await expect(page.getByText('混音成品', { exact: true })).toBeVisible({ timeout: 60_000 })

    const latest = await json<{ items: Array<{ id: string }> }>(
      await request.get(`${API}/api/artifacts`, { params: { type: 'mix', limit: 1 } }),
    )
    const audio = await request.get(`${API}/api/artifacts/${latest.items[0].id}/audio`)
    expect(audio.ok()).toBeTruthy()
    expect((await audio.body()).byteLength).toBeGreaterThan(44)
  })

  test('TTS 粘贴文本可独立合成', async ({ page }) => {
    await page.goto('/tts')
    await page.getByPlaceholder(/输入文本，可包含/).fill('E2E 直接粘贴文本。[停顿 1s]继续放松。')
    await chooseWav(page)
    await page.getByRole('button', { name: '开始合成人声' }).click()
    await expect(page.getByText('人声干声', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.tts-result audio')).toHaveAttribute('src', /\/api\/artifacts\/.+\/audio/)
  })

  test('第二个任务排队并显示队列位置，运行中任务可取消', async ({ page, request }) => {
    await armRun(request, { kind: 'tts', delay_seconds: 3 })
    await page.goto('/tts')
    await page.getByPlaceholder(/输入文本，可包含/).fill('E2E 运行中取消。')
    await chooseWav(page)
    const firstResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/tts/jobs') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '开始合成人声' }).click()
    const first = await (await firstResponse).json() as { run_id: string }
    await waitForRun(request, first.run_id, ['running'])

    const second = await submitTts(request, 'E2E 第二个排队任务。')
    const queued = await waitForRun(request, second.run_id, ['queued'])
    // queue_position 表示前方 queued 数；首个任务已 running，因此第二个是 0。
    expect(queued.queue_position).toBe(0)

    await page.getByRole('button', { name: '取消任务' }).click()
    await waitForRun(request, first.run_id, ['cancelled'])
    await expect(page.getByText(/任务已取消/)).toBeVisible()
    await waitForRun(request, second.run_id, ['completed'])
  })

  test('冥想生成运行中刷新后从 run.status 快照恢复', async ({ page, request }) => {
    await page.goto('/meditation')
    await page.getByRole('button', { name: '新建会话' }).click()
    await armRun(request, { kind: 'script', delay_seconds: 2 })
    await page.getByPlaceholder(/描述你想要的冥想主题/).fill('E2E 刷新恢复测试')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.getByTestId('generating-panel')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('generating-panel')).toBeVisible()
    await expect(page.getByText('生成结果', { exact: true })).toBeVisible({ timeout: 30_000 })
  })

  test('失败卡片与 BGM 两档重试分支', async ({ page, request }) => {
    await armRun(request, {
      kind: 'music',
      failure_code: 'MUSIC_DOWNLOAD_FAILED',
      failure_message: 'E2E 注入下载失败',
    })
    await page.goto('/bgm')
    const prompt = page.getByPlaceholder(/空灵缓慢的冥想背景音乐/)
    await prompt.fill('E2E 付费重新生成分支')
    await setMinimumDuration(page)
    await chooseWav(page)
    await page.getByRole('button', { name: '生成纯音乐' }).click()
    await expect(page.getByRole('alert')).toContainText('E2E 注入下载失败')
    await expect(page.getByRole('button', { name: '重新下载（免计费）' })).toHaveCount(0)
    await page.getByRole('button', { name: '重新生成' }).click()
    await page.getByRole('button', { name: '确认并重新生成' }).click()
    await expect(page.getByText('背景音乐', { exact: true })).toBeVisible({ timeout: 60_000 })

    await armRun(request, {
      kind: 'music',
      failure_code: 'MUSIC_DOWNLOAD_FAILED',
      failure_message: 'E2E 注入可重下失败',
      download_available: true,
    })
    await prompt.fill('E2E 免费重新下载分支')
    await page.getByRole('button', { name: '生成纯音乐' }).click()
    await expect(page.getByRole('button', { name: '重新下载（免计费）' })).toBeVisible()
    await page.getByRole('button', { name: '重新下载（免计费）' }).click()
    await expect(page.getByText('背景音乐', { exact: true })).toBeVisible({ timeout: 60_000 })
  })

  test('产物库详情、重命名、送下游、删除与清空', async ({ page, request }) => {
    const seeded = await submitTts(request, 'E2E 产物库独立种子。')
    await waitForRun(request, seeded.run_id, ['completed'])
    await page.goto('/library')
    const downstreamCard = page.locator('.library-card').filter({ has: page.getByRole('button', { name: '送去混音' }) }).first()
    await expect(downstreamCard).toBeVisible()
    await downstreamCard.getByRole('button', { name: '详情' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    await downstreamCard.getByRole('button', { name: '重命名' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill('E2E 已重命名产物')
    await page.getByRole('dialog').getByRole('button', { name: /保\s*存/ }).click()
    await expect(page.getByText('E2E 已重命名产物')).toBeVisible()

    await page.locator('.library-card').filter({ hasText: 'E2E 已重命名产物' }).getByRole('button', { name: '送去混音' }).click()
    await expect(page).toHaveURL(/\/mixdown\?/)
    await page.goto('/library')
    const renamed = page.locator('.library-card').filter({ hasText: 'E2E 已重命名产物' })
    await renamed.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: /删\s*除/ }).last().click()
    await expect(page.getByText('E2E 已重命名产物')).toHaveCount(0)

    const clearSeed = await submitTts(request, 'E2E 清空操作种子。')
    await waitForRun(request, clearSeed.run_id, ['completed'])
    await page.reload()
    await expect(page.getByRole('button', { name: '清空全部' })).toBeEnabled()
    await page.getByRole('button', { name: '清空全部' }).click()
    await page.getByRole('button', { name: /确\s*认\s*清\s*空/ }).click()
    await expect(page.getByText('产物库为空')).toBeVisible()
  })
})
