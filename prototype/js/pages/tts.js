/* ============================================================
   TTS 人声合成页
   脚本来源（产物库/粘贴）+ 引擎/音色/语速/音调
   → Web Audio 占位合成 → 波形预览播放 → 入库/送最终合成
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  const GEN_STEPS = [
    '加载脚本文本',
    '连接 TTS 引擎',
    '解析情绪与语速标记',
    '逐句合成人声干声',
    '后处理与响度归一',
  ];

  // 全局设置：语音合成引擎池（设置页配置；默认引擎为初始值，页内切换不回写全局）
  const ENGINE_POOL = (() => {
    const s = Store.getSettings().tts;
    const options = Mock.TTS_ENGINES.filter(e => s.enabled.includes(e.id));
    const initial = options.some(e => e.id === s.default) ? s.default : options[0].id;
    return { options, initial };
  })();

  const state = {
    source: 'paste',        // 'paste' 或脚本产物 id
    pastedText: '',
    engine: ENGINE_POOL.initial,
    voiceId: (Mock.VOICES.find(v => v.engine === ENGINE_POOL.initial) || Mock.VOICES[0]).id,
    speed: 0.8,
    pitch: 1.0,
    generating: false,
    stepDone: 0,
    progress: 0,
    result: null,           // { buffer, silences, params }
    stale: false,
    savedId: null,
    dirty: false,
    audition: null,         // { buffer }
  };

  const mainPlayer = new AudioEngine.BufferPlayer();
  const auditionPlayer = new AudioEngine.BufferPlayer();
  const ui = {};            // DOM 引用缓存
  let rafId = null;

  // ---------- 工具 ----------

  function scriptArtifacts() {
    return [...Store.list('script_meditation'), ...Store.list('script_podcast')];
  }

  function currentScriptArtifact() {
    return state.source === 'paste' ? null : Store.get(state.source);
  }

  function currentText() {
    const art = currentScriptArtifact();
    if (art) return art.content?.text || '';
    return state.pastedText;
  }

  function sceneVoices() {
    return Mock.VOICES.filter(v => v.engine === state.engine);
  }

  function pickDefaultVoice() {
    state.voiceId = sceneVoices()[0].id;
  }

  function stopAll() {
    mainPlayer.stop();
    auditionPlayer.stop();
  }

  function markStale() {
    if (state.result) state.stale = true;
  }

  // ---------- 渲染 ----------

  function render() {
    const scripts = scriptArtifacts();
    const art = currentScriptArtifact();
    const voices = sceneVoices();
    if (!voices.find(v => v.id === state.voiceId)) pickDefaultVoice();

    root.innerHTML = `
      <div class="grid-2">
        <div>
          <div class="card">
            <div class="card-title">合成参数</div>
            <div class="card-desc">对应 PRD 模块 3：TTS 合成（统一人声合成引擎）。</div>

            <div class="field">
              <label class="field-label">脚本文本来源</label>
              <select class="select" id="source-select">
                <option value="paste" ${state.source === 'paste' ? 'selected' : ''}>粘贴文本（自定义输入）</option>
                ${scripts.length ? `
                  <optgroup label="冥想脚本">
                    ${scripts.filter(a => a.type === 'script_meditation').map(a =>
                      `<option value="${a.id}" ${state.source === a.id ? 'selected' : ''}>${Util.escapeHtml(a.name)}</option>`).join('')}
                  </optgroup>
                  <optgroup label="播客脚本">
                    ${scripts.filter(a => a.type === 'script_podcast').map(a =>
                      `<option value="${a.id}" ${state.source === a.id ? 'selected' : ''}>${Util.escapeHtml(a.name)}</option>`).join('')}
                  </optgroup>` : ''}
              </select>
            </div>

            ${state.source === 'paste' ? `
              <div class="field">
                <label class="field-label">脚本文本<span class="req">*</span></label>
                <textarea class="textarea" id="paste-input" placeholder="粘贴或输入要合成的脚本文本（冥想脚本可包含 [停顿 3s] [情绪:温柔] 等标记）……">${Util.escapeHtml(state.pastedText)}</textarea>
              </div>` : `
              <div class="field">
                <label class="field-label">脚本预览${art?.type === 'script_meditation' ? '（含标记，将供 TTS 识别）' : ''}</label>
                <div class="script-preview-sm">${Util.renderScript(currentText())}</div>
              </div>`}

            <div class="field">
              <label class="field-label">TTS 引擎</label>
              <select class="select" id="engine-select">
                ${ENGINE_POOL.options.map(e =>
                  `<option value="${e.id}" ${state.engine === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}
              </select>
            </div>

            <div class="field">
              <label class="field-label">音色</label>
              <div class="inline-flex" style="width:100%">
                <select class="select" id="voice-select" style="flex:1">
                  ${voices.map(v =>
                    `<option value="${v.id}" ${state.voiceId === v.id ? 'selected' : ''}>${v.name} · ${v.desc}</option>`).join('')}
                </select>
                <button class="btn small" id="audition-btn" ${state.generating ? 'disabled' : ''}>试听</button>
              </div>
              <div id="audition-area" class="mt-8"></div>
            </div>

            <div class="field">
              <label class="field-label">语速调节</label>
              <div class="slider-row">
                <input type="range" id="speed-slider" min="0.5" max="1.5" step="0.05" value="${state.speed}">
                <span class="slider-value" id="speed-val">${state.speed.toFixed(2)}x</span>
              </div>
            </div>

            <div class="field">
              <label class="field-label">音调调节（可选）</label>
              <div class="slider-row">
                <input type="range" id="pitch-slider" min="0.8" max="1.2" step="0.05" value="${state.pitch}">
                <span class="slider-value ${state.pitch === 1 ? 'neutral' : ''}" id="pitch-val">${state.pitch.toFixed(2)}x</span>
              </div>
            </div>

            <button class="btn primary block" id="synth-btn" ${state.generating ? 'disabled' : ''}>
              ${state.result ? '重新合成人声' : '开始合成人声'}
            </button>
          </div>
        </div>
        <div>
          <div class="card" id="result-card">${renderResultArea()}</div>
        </div>
      </div>`;
    bind();
    if (state.result && !state.stale) drawMainWave();
    refreshTransport();
  }

  function renderResultArea() {
    if (state.generating) {
      return `
        <div class="card-title">合成中</div>
        <div class="gen-panel">
          ${GEN_STEPS.map((s, i) => `
            <div class="gen-step ${i < state.stepDone ? 'done' : i === state.stepDone ? 'active' : ''}">
              <span class="gs-icon">${i < state.stepDone ? Layout.icons.check : ''}</span>${s}
            </div>`).join('')}
          <div class="progress"><div class="bar" style="width:${state.progress}%"></div></div>
        </div>`;
    }
    if (!state.result) {
      return `
        <div class="empty-state">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 12h3l2-6 4 12 2.5-8 1.5 2h5"/></svg>
          <div class="es-title">尚未合成人声</div>
          <div class="es-desc">选择脚本来源并设置引擎、音色与语速，点击「开始合成人声」<br>合成结果为纯人声干声，可单独保存或送去最终合成</div>
        </div>`;
    }
    const p = state.result.params;
    return `
      <div class="flex-between mb-8">
        <div class="card-title mb-0">人声干声</div>
        <span class="type-badge tb-voice">人声干声</span>
      </div>
      <div class="param-chips mb-16">
        <span class="param-chip">${Mock.engineById(p.engine).name}</span>
        <span class="param-chip">${p.voiceName}</span>
        <span class="param-chip">语速 ${p.speed.toFixed(2)}x</span>
        <span class="param-chip">音调 ${p.pitch.toFixed(2)}x</span>
        <span class="param-chip">来源：${p.scriptName || '粘贴文本'}</span>
      </div>
      ${state.stale ? `
        <div class="stale-banner">
          ${Layout.icons.info}
          参数已变化，当前预览仍为上次合成的结果；点击「重新合成人声」以应用新参数。
        </div>` : ''}
      <div class="wave-panel">
        <div class="wave-label"><span>人声波形（灰色区段为停顿）</span><span id="main-duration">${Util.fmtTime(mainPlayer.duration)}</span></div>
        <canvas class="wave" id="main-canvas"></canvas>
        <div class="transport">
          <button class="play-btn" id="main-play"></button>
          <span class="time-display" id="main-time"><b>00:00</b> / ${Util.fmtTime(mainPlayer.duration)}</span>
          <span class="transport-note">占位合成音（Web Audio 演示，非真实 TTS）</span>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn small" id="save-btn">${state.savedId && !state.dirty ? '已存入产物库' : '存入产物库'}</button>
        <span style="flex:1"></span>
        <button class="btn small primary" id="to-mix-btn">送去最终合成 ${Layout.icons.arrow}</button>
      </div>`;
  }

  // ---------- 事件 ----------

  function bind() {
    ui.sourceSelect = document.getElementById('source-select');
    ui.pasteInput = document.getElementById('paste-input');
    ui.mainCanvas = document.getElementById('main-canvas');
    ui.mainPlay = document.getElementById('main-play');
    ui.mainTime = document.getElementById('main-time');
    ui.auditionArea = document.getElementById('audition-area');

    ui.sourceSelect?.addEventListener('change', e => {
      state.source = e.target.value;
      markStale();
      render();
    });

    ui.pasteInput?.addEventListener('input', e => {
      state.pastedText = e.target.value;
      markStale();
    });

    document.getElementById('engine-select')?.addEventListener('change', e => {
      if (state.engine === e.target.value) return;
      state.engine = e.target.value;
      pickDefaultVoice();
      markStale();
      render();
    });

    document.getElementById('voice-select')?.addEventListener('change', e => {
      state.voiceId = e.target.value;
      state.audition = null;
      markStale();
      render();
    });

    document.getElementById('audition-btn')?.addEventListener('click', doAudition);

    const speedSlider = document.getElementById('speed-slider');
    speedSlider?.addEventListener('input', e => {
      state.speed = parseFloat(e.target.value);
      const v = document.getElementById('speed-val');
      if (v) v.textContent = state.speed.toFixed(2) + 'x';
      markStale();
    });

    const pitchSlider = document.getElementById('pitch-slider');
    pitchSlider?.addEventListener('input', e => {
      state.pitch = parseFloat(e.target.value);
      const v = document.getElementById('pitch-val');
      if (v) { v.textContent = state.pitch.toFixed(2) + 'x'; v.classList.toggle('neutral', state.pitch === 1); }
      markStale();
    });

    document.getElementById('synth-btn')?.addEventListener('click', doSynth);

    ui.mainPlay?.addEventListener('click', () => {
      if (mainPlayer.playing) mainPlayer.pause();
      else { auditionPlayer.stop(); mainPlayer.play(); }
      refreshTransport();
      startLoop();
    });

    document.getElementById('save-btn')?.addEventListener('click', () => doSave());
    document.getElementById('to-mix-btn')?.addEventListener('click', () => {
      const art = doSave(true);
      Store.setHandoff({ target: 'mixdown', artifactId: art.id });
      location.href = 'mixdown.html';
    });
  }

  // ---------- 音色试听 ----------

  async function doAudition() {
    stopAll();
    const voice = Mock.voiceById(state.voiceId);
    const text = '你好，这是当前音色的试听效果，今天也要保持平静呀。';
    const segments = AudioEngine.parseScript(text);
    const buffer = await AudioEngine.renderVoice({ segments, voice, speed: 1, pitch: 1, seedKey: 'audition:' + voice.id });
    state.audition = { buffer, voiceId: state.voiceId };
    ui.auditionArea = document.getElementById('audition-area');
    if (ui.auditionArea) {
      ui.auditionArea.innerHTML = `
        <div class="inline-flex" style="width:100%;background:var(--bg-soft);border:1px solid var(--border-soft);border-radius:8px;padding:7px 12px">
          <button class="play-btn ghost" id="aud-play" style="width:30px;height:30px"></button>
          <span class="text-sm text-dim" style="flex:1;margin-left:10px">${voice.name} 试听（语速 1.0x）</span>
          <span class="time-display" id="aud-time" style="font-size:11.5px">00:00 / ${Util.fmtTime(buffer.duration)}</span>
        </div>`;
      document.getElementById('aud-play').addEventListener('click', () => {
        if (auditionPlayer.playing) auditionPlayer.pause();
        else { mainPlayer.stop(); auditionPlayer.play(0); }
        refreshTransport();
        startLoop();
      });
      ui.audPlay = document.getElementById('aud-play');
      ui.audTime = document.getElementById('aud-time');
    }
    refreshTransport();
    Util.toast(`已生成「${voice.name}」试听，点击播放`, 'success');
  }

  // ---------- 合成 ----------

  async function doSynth() {
    const text = currentText();
    if (!text || text.trim().length < 5) { Util.toast('请先填写至少 5 个字的脚本文本', 'error'); return; }
    stopAll();
    state.generating = true;
    state.stepDone = 0;
    state.progress = 0;
    render();

    await Mock.fakeTask(GEN_STEPS, {
      minMs: 1400, maxMs: 2100,
      onStep: i => {
        state.stepDone = i;
        state.progress = Math.round((i / GEN_STEPS.length) * 100);
        const card = document.getElementById('result-card');
        if (card) card.innerHTML = renderResultArea();
      },
    });

    const voice = Mock.voiceById(state.voiceId);
    const art = currentScriptArtifact();
    const segments = AudioEngine.parseScript(text);
    const params = {
      engine: state.engine, voiceId: voice.id, voiceName: voice.name,
      speed: state.speed, pitch: state.pitch,
      scriptId: art ? art.id : null, scriptName: art ? art.name : null,
    };
    const buffer = await AudioEngine.renderVoice({
      segments, voice, speed: state.speed, pitch: state.pitch,
      seedKey: `${art ? art.id : 'paste'}|${voice.id}|${state.speed}|${state.pitch}`,
    });
    const { silences } = AudioEngine.detectVoiceActivity(buffer, { minSec: 0.8 });

    mainPlayer.setBuffer(buffer);
    state.result = { buffer, silences, params, text };
    state.savedId = null;
    state.dirty = false;
    state.stale = false;
    state.generating = false;
    render();
    Util.toast(`人声合成完成（${Util.fmtTime(buffer.duration)}）`, 'success');
  }

  function doSave(silent = false) {
    if (!state.result) return null;
    const id = state.savedId || Util.uid();
    const p = state.result.params;
    const artifact = {
      id,
      type: 'voice',
      name: `人声 · ${p.voiceName} · ${p.scriptName ? p.scriptName.replace(/^(冥想脚本|播客脚本) · /, '') : '自定义文本'}`,
      createdAt: state.savedId ? undefined : Date.now(),
      params: { ...p },
      content: { text: state.result.text },
    };
    Store.save(artifact);
    state.savedId = id;
    state.dirty = false;
    if (!silent) { render(); Util.toast('已存入产物库', 'success'); }
    return artifact;
  }

  // ---------- 播放 UI ----------

  function drawMainWave() {
    if (!ui.mainCanvas || !state.result) return;
    const pos = mainPlayer.position;
    AudioEngine.drawBuffer(ui.mainCanvas, state.result.buffer, {
      progressSec: mainPlayer.playing || pos > 0 ? pos : null,
      color: '#3a4258', playedColor: '#b28cff',
      regions: (state.result.silences || []).map(s => ({ start: s.start, end: s.end, color: 'rgba(120,130,160,0.16)' })),
    });
  }

  function playIcon(playing) {
    return playing ? Layout.icons.pause : Layout.icons.play;
  }

  function refreshTransport() {
    if (ui.mainPlay) {
      ui.mainPlay.innerHTML = playIcon(mainPlayer.playing);
      ui.mainPlay.disabled = !mainPlayer.buffer;
    }
    if (ui.mainTime) {
      ui.mainTime.innerHTML = `<b>${Util.fmtTime(mainPlayer.position)}</b> / ${Util.fmtTime(mainPlayer.duration)}`;
    }
    if (ui.audPlay) {
      ui.audPlay.innerHTML = playIcon(auditionPlayer.playing);
      if (ui.audTime) ui.audTime.textContent = `${Util.fmtTime(auditionPlayer.position)} / ${Util.fmtTime(auditionPlayer.duration)}`;
    }
  }

  function startLoop() {
    if (rafId != null) return;
    const tick = () => {
      drawMainWave();
      refreshTransport();
      if (mainPlayer.playing || auditionPlayer.playing) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        drawMainWave();
        refreshTransport();
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  mainPlayer.onEnded = () => { refreshTransport(); startLoop(); };
  auditionPlayer.onEnded = () => { refreshTransport(); startLoop(); };

  // ---------- 初始化：处理上游交接 ----------

  const handoff = Store.takeHandoff('tts');
  if (handoff) {
    const art = Store.get(handoff.artifactId);
    if (art && (art.type === 'script_meditation' || art.type === 'script_podcast')) {
      state.source = art.id;
    }
  }

  render();
})();
