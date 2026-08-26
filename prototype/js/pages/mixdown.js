/* ============================================================
   最终合成页
   人声轨 + 背景音轨（可选）→ 音量比例 / 偏移 / 闪避 → 预览与导出
   闪避双模式（PRD 字面 / 常规）可切换，辅助产品决策
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  const state = {
    voiceArtId: 'none',
    bgmArtId: 'none',
    voiceVol: 1.0,
    bgmVol: 0.35,
    offset: 0,            // 背景音起始偏移（秒）
    duckOn: true,
    duckMode: 'A',        // 'A' 静音段压低（PRD 字面）| 'B' 人声时压低（常规）
    format: 'mp3',
    voiceTrack: null,     // { artifact, buffer, silences, voiceSegs }
    bgmTrack: null,       // { artifact, buffer, sections }
    effectiveBgm: null,
    loading: false,
    exporting: false,
    savedId: null,
  };

  const voicePlayer = new AudioEngine.BufferPlayer();
  const bgmPlayer = new AudioEngine.BufferPlayer();
  const ui = {};
  let rafId = null;
  let loadToken = 0;
  const trackCache = new Map();

  // ---------- 音轨加载（带缓存，配方确定性重合成） ----------

  async function getVoiceTrack(artId) {
    const key = 'v:' + artId;
    if (trackCache.has(key)) return trackCache.get(key);
    const art = Store.get(artId);
    if (!art || art.type !== 'voice') return null;
    const voice = Mock.voiceById(art.params.voiceId);
    const segments = AudioEngine.parseScript(art.content?.text || '');
    const buffer = await AudioEngine.renderVoice({
      segments, voice,
      speed: art.params.speed || 1,
      pitch: art.params.pitch || 1,
      seedKey: `${artId}|${art.params.speed}|${art.params.pitch}`,
    });
    const va = AudioEngine.detectVoiceActivity(buffer, { minSec: 1.0 });
    const track = { artifact: art, buffer, silences: va.silences, voiceSegs: va.voiceSegs };
    trackCache.set(key, track);
    return track;
  }

  async function getBgmTrack(artId) {
    const key = 'b:' + artId;
    if (trackCache.has(key)) return trackCache.get(key);
    const art = Store.get(artId);
    if (!art || art.type !== 'bgm') return null;
    const p = art.params;
    const style = Mock.styleById(p.styleId);
    const fusion = Mock.resolveFusion(p.fusionText);
    const { buffer, sections } = await AudioEngine.renderMusic({
      style, fusion, duration: (p.duration || 3) * 60,
      structure: p.structure || [],
      seedKey: `${p.styleId}|${p.fusionText || ''}|${p.duration}|${(p.structure || []).join(',')}`,
    });
    const track = { artifact: art, buffer, sections };
    trackCache.set(key, track);
    return track;
  }

  async function loadTracks() {
    const token = ++loadToken;
    state.loading = true;
    render();
    const [v, b] = await Promise.all([
      state.voiceArtId === 'none' ? null : getVoiceTrack(state.voiceArtId),
      state.bgmArtId === 'none' ? null : getBgmTrack(state.bgmArtId),
    ]);
    if (token !== loadToken) return; // 已被新一轮加载取代
    state.voiceTrack = v;
    state.bgmTrack = b;
    rebuildEffective();
    state.loading = false;
    render();
  }

  function timelineDur() {
    if (state.voiceTrack) return state.voiceTrack.buffer.duration;
    if (state.bgmTrack) return state.bgmTrack.buffer.duration;
    return 0;
  }

  // 重建背景音有效轨（偏移 + 循环填充/截断）
  function rebuildEffective() {
    // 人声缓冲仅在音轨变化时重设，避免播放中偏移调节打断人声
    if (state.voiceTrack) {
      if (voicePlayer.buffer !== state.voiceTrack.buffer) voicePlayer.setBuffer(state.voiceTrack.buffer);
    } else if (voicePlayer.buffer) {
      voicePlayer.setBuffer(null);
    }
    if (state.bgmTrack) {
      const off = state.voiceTrack ? state.offset : 0; // 无人声时偏移无意义
      state.effectiveBgm = AudioEngine.buildEffectiveBgm(state.bgmTrack.buffer, off, timelineDur());
      bgmPlayer.setBuffer(state.effectiveBgm);
    } else {
      state.effectiveBgm = null;
      bgmPlayer.setBuffer(null);
    }
    voicePlayer.setVolume(state.voiceVol);
    bgmPlayer.setVolume(state.bgmVol);
  }

  // ---------- 播放控制 ----------

  function getPos() {
    return voicePlayer.buffer ? voicePlayer.position : bgmPlayer.position;
  }

  function isPlaying() {
    return voicePlayer.playing || bgmPlayer.playing;
  }

  function stopAll() {
    voicePlayer.stop();
    bgmPlayer.stop();
  }

  function duckSegments() {
    if (!state.voiceTrack) return [];
    return state.duckMode === 'A' ? state.voiceTrack.silences : state.voiceTrack.voiceSegs;
  }

  function duckActive() {
    return state.duckOn && !!state.voiceTrack && !!state.bgmTrack;
  }

  function scheduleDuckNow(fromPos) {
    AudioEngine.scheduleDuck(bgmPlayer.duckParam(), {
      mode: duckActive() ? state.duckMode : 'off',
      segments: duckSegments(),
      fromPosition: fromPos,
    });
  }

  function playAll() {
    AudioEngine.ensureCtx();
    const pos = getPos();
    if (voicePlayer.buffer) voicePlayer.play(pos);
    if (bgmPlayer.buffer) bgmPlayer.play(pos);
    scheduleDuckNow(pos);
    startLoop();
  }

  function pauseAll() {
    voicePlayer.pause();
    bgmPlayer.pause();
  }

  // ---------- 规则与展示 ----------

  function computeRules() {
    const rules = [];
    if (state.voiceTrack && state.bgmTrack) {
      const vDur = state.voiceTrack.buffer.duration;
      const bDur = state.bgmTrack.buffer.duration;
      if (state.offset > 0) rules.push({ color: '#5aa9e6', text: `背景音起始偏移 ${state.offset}s` });
      if (bDur + state.offset < vDur - 0.1) {
        const loops = Math.ceil((vDur - state.offset) / bDur);
        rules.push({ color: '#e6b25a', text: `背景音短于人声：循环填充（共 ${loops} 段）` });
      } else if (bDur + state.offset > vDur + 0.1) {
        rules.push({ color: '#e6b25a', text: '背景音长于人声：播放至人声结束处截断' });
      } else {
        rules.push({ color: '#2cc9a7', text: '背景音与人声等长：直接对齐叠加' });
      }
      if (state.duckOn) {
        rules.push({
          color: '#e0635c',
          text: `闪避已开启 · 模式${state.duckMode}（${state.duckMode === 'A' ? '静音段压低背景音' : '人声出现时压低背景音'}）`,
        });
      } else {
        rules.push({ color: '#6b7488', text: '闪避已关闭' });
      }
    } else if (state.voiceTrack) {
      rules.push({ color: '#2cc9a7', text: '未选择背景音：仅人声，直接透传导出' });
    } else if (state.bgmTrack) {
      rules.push({ color: '#2cc9a7', text: '未选择人声：纯背景音导出（纯音乐路径）' });
      rules.push({ color: '#6b7488', text: '闪避不可用（无人声轨）' });
    }
    return rules;
  }

  // ---------- 渲染 ----------

  function render() {
    const voices = Store.list('voice');
    const bgms = Store.list('bgm');
    const rules = computeRules();
    const canExport = !state.loading && (state.voiceTrack || state.bgmTrack);

    root.innerHTML = `
      <div class="mix-layout">
        <div>
          <div class="card">
            <div class="card-title">合成配置</div>
            <div class="card-desc">对应 PRD 模块 5：最终合成（组合层）。</div>

            <div class="field">
              <label class="field-label">人声轨</label>
              <select class="select" id="voice-select">
                <option value="none" ${state.voiceArtId === 'none' ? 'selected' : ''}>无（纯背景音导出）</option>
                ${voices.map(a => `<option value="${a.id}" ${state.voiceArtId === a.id ? 'selected' : ''}>${Util.escapeHtml(a.name)}</option>`).join('')}
              </select>
              ${!voices.length ? '<div class="field-hint">产物库暂无人声干声，可先在 TTS 合成页生成</div>' : ''}
            </div>

            <div class="field">
              <label class="field-label">背景音轨（可选，可跳过）</label>
              <select class="select" id="bgm-select">
                <option value="none" ${state.bgmArtId === 'none' ? 'selected' : ''}>跳过背景音</option>
                ${bgms.map(a => `<option value="${a.id}" ${state.bgmArtId === a.id ? 'selected' : ''}>${Util.escapeHtml(a.name)}</option>`).join('')}
              </select>
              ${!bgms.length ? '<div class="field-hint">产物库暂无背景音，可先在背景音生成页生成</div>' : ''}
            </div>

            ${state.voiceTrack && state.bgmTrack ? `
            <div class="field">
              <label class="field-label">人声音量</label>
              <div class="slider-row">
                <input type="range" id="voice-vol" min="0" max="1" step="0.05" value="${state.voiceVol}">
                <span class="slider-value" id="voice-vol-val">${Math.round(state.voiceVol * 100)}%</span>
              </div>
            </div>
            <div class="field">
              <label class="field-label">背景音音量</label>
              <div class="slider-row">
                <input type="range" id="bgm-vol" min="0" max="1" step="0.05" value="${state.bgmVol}">
                <span class="slider-value" id="bgm-vol-val">${Math.round(state.bgmVol * 100)}%</span>
              </div>
              <div class="field-hint">人声 / 背景音相对音量比例，播放中实时生效</div>
            </div>
            <div class="field">
              <label class="field-label">背景音起始位置偏移</label>
              <div class="slider-row">
                <input type="range" id="offset-slider" min="0" max="20" step="0.5" value="${state.offset}">
                <span class="slider-value ${state.offset === 0 ? 'neutral' : ''}" id="offset-val">${state.offset.toFixed(1)}s</span>
              </div>
              <div class="field-hint">播放中调节会实时重排背景音轨（循环填充 / 截断随之更新）</div>
            </div>
            ` : ''}

            ${state.voiceTrack && state.bgmTrack ? `
            <hr class="divider">
            <div class="field">
              <label class="switch-label" style="margin-bottom:10px">
                <span class="switch"><input type="checkbox" id="duck-switch" ${state.duckOn ? 'checked' : ''}><span class="track"></span></span>
                <span style="font-weight:600;color:var(--text)">闪避效果</span>
              </label>
              <div class="segmented" id="duck-mode-seg" style="${state.duckOn ? '' : 'opacity:.4;pointer-events:none'}">
                <button data-m="A" class="${state.duckMode === 'A' ? 'active' : ''}" title="PRD 3.5 字面定义">模式 A · 静音段压低</button>
                <button data-m="B" class="${state.duckMode === 'B' ? 'active' : ''}" title="行业常规闪避">模式 B · 人声时压低</button>
              </div>
              <div class="duck-info">
                <b>模式 A（PRD 字面）</b>：人声静音段（≥1s）自动压低背景音，人声出现时恢复。<br>
                <b>模式 B（常规闪避）</b>：人声出现时压低背景音，静音段恢复。<br>
                PRD 3.5 疑似与行业惯例相反，原型提供双模式切换辅助产品决策。
              </div>
            </div>
            ` : ''}
          </div>

          <div class="card">
            <div class="card-title">导出</div>
            ${rules.length ? `
              <div id="rules-box" style="margin-bottom:14px">
                ${rules.map(r => `<span class="rule-tag"><i style="background:${r.color}"></i>${r.text}</span>`).join('')}
              </div>` : '<div class="card-desc">选择音轨后显示合成规则</div>'}
            <div class="field">
              <label class="field-label">导出格式</label>
              <div class="radio-cards">
                <div class="radio-card ${state.format === 'mp3' ? 'active' : ''}" data-f="mp3">
                  <span class="dot"></span>
                  <span><span class="rc-name">MP3</span><span class="rc-desc">320kbps</span></span>
                </div>
                <div class="radio-card ${state.format === 'wav' ? 'active' : ''}" data-f="wav">
                  <span class="dot"></span>
                  <span><span class="rc-name">WAV</span><span class="rc-desc">16bit / 44.1kHz</span></span>
                </div>
              </div>
            </div>
            <div class="btn-row" style="margin-top:6px">
              <button class="btn" id="save-btn" ${canExport ? '' : 'disabled'}>存入产物库</button>
              <button class="btn primary" id="export-btn" ${canExport && !state.exporting ? '' : 'disabled'}>
                ${state.exporting ? '导出中…' : '导出成品音频'}
              </button>
            </div>
            <div class="note">
              ${Layout.icons.info}
              <span>原型说明：导出为示意流程（Mock），不产出真实文件；导出成功后成品将存入产物库。</span>
            </div>
          </div>
        </div>

        <div>
          <div class="card" id="preview-card">${renderPreview()}</div>
        </div>
      </div>`;
    bind();
    drawAll();
    refreshTransport();
  }

  function renderPreview() {
    if (state.loading) {
      return `
        <div class="card-title">正在准备音轨</div>
        <div class="gen-panel">
          <div class="gen-step active"><span class="gs-icon"></span>按产物配方重合成人声 / 背景音占位音频…</div>
          <div class="progress"><div class="bar" style="width:60%"></div></div>
        </div>`;
    }
    if (!state.voiceTrack && !state.bgmTrack) {
      return `
        <div class="empty-state">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="1.8" fill="currentColor"/><circle cx="15" cy="12" r="1.8" fill="currentColor"/><circle cx="7" cy="18" r="1.8" fill="currentColor"/></svg>
          <div class="es-title">尚未选择音轨</div>
          <div class="es-desc">在左侧选择人声轨与背景音轨（背景音可跳过）<br>选择后可预览双轨叠加波形并试听混音效果</div>
        </div>`;
    }
    const duckLegend = state.voiceTrack && state.bgmTrack
      ? '（琥珀色区段为当前闪避模式的作用区段）' : '';
    return `
      <div class="flex-between mb-8">
        <div class="card-title mb-0">成品预览</div>
        <span class="type-badge tb-mix">成品</span>
      </div>
      <div class="param-chips mb-16">
        <span class="param-chip">人声：${state.voiceTrack ? state.voiceTrack.artifact.name.replace('人声 · ', '') : '无'}</span>
        <span class="param-chip">背景音：${state.bgmTrack ? state.bgmTrack.artifact.name.replace('背景音 · ', '') : '无'}</span>
        <span class="param-chip">总时长：${Util.fmtTime(timelineDur())}</span>
      </div>
      ${state.voiceTrack ? `
      <div class="wave-panel" style="margin-bottom:12px">
        <div class="wave-label"><span>人声轨（灰色为静音段 ≥1s）</span><span>${Util.fmtTime(voicePlayer.duration)}</span></div>
        <canvas class="wave" id="voice-canvas"></canvas>
      </div>` : ''}
      ${state.bgmTrack ? `
      <div class="wave-panel">
        <div class="wave-label"><span>背景音轨（含偏移 / 循环 / 截断）${duckLegend}</span><span>${Util.fmtTime(bgmPlayer.duration)}</span></div>
        <canvas class="wave" id="bgm-canvas"></canvas>
      </div>` : ''}
      <div class="transport" style="margin-top:16px">
        <button class="play-btn" id="mix-play"></button>
        <button class="play-btn ghost" id="mix-stop" title="停止">${Layout.icons.stop}</button>
        <span class="time-display" id="mix-time"><b>00:00</b> / ${Util.fmtTime(timelineDur())}</span>
        <span class="transport-note">Web Audio 实时混音演示 · 音量 / 偏移 / 闪避播放中实时生效</span>
      </div>`;
  }

  // ---------- 事件 ----------

  function bind() {
    ui.voiceCanvas = document.getElementById('voice-canvas');
    ui.bgmCanvas = document.getElementById('bgm-canvas');
    ui.playBtn = document.getElementById('mix-play');
    ui.timeEl = document.getElementById('mix-time');

    document.getElementById('voice-select')?.addEventListener('change', e => {
      state.voiceArtId = e.target.value;
      stopAll();
      loadTracks();
    });
    document.getElementById('bgm-select')?.addEventListener('change', e => {
      state.bgmArtId = e.target.value;
      stopAll();
      loadTracks();
    });

    const bindVolSlider = (id, valId, apply) => {
      const s = document.getElementById(id);
      s?.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        apply(v);
        const label = document.getElementById(valId);
        if (label) label.textContent = Math.round(v * 100) + '%';
      });
    };
    bindVolSlider('voice-vol', 'voice-vol-val', v => { state.voiceVol = v; voicePlayer.setVolume(v); });
    bindVolSlider('bgm-vol', 'bgm-vol-val', v => { state.bgmVol = v; bgmPlayer.setVolume(v); });

    document.getElementById('offset-slider')?.addEventListener('input', e => {
      state.offset = parseFloat(e.target.value);
      const v = document.getElementById('offset-val');
      if (v) { v.textContent = state.offset.toFixed(1) + 's'; v.classList.toggle('neutral', state.offset === 0); }
      rebuildEffective();
      if (isPlaying()) {
        const pos = getPos();
        if (bgmPlayer.buffer) bgmPlayer.play(pos);
        scheduleDuckNow(pos);
      }
      renderRules();
      drawAll();
    });

    document.getElementById('duck-switch')?.addEventListener('change', e => {
      state.duckOn = e.target.checked;
      const seg = document.getElementById('duck-mode-seg');
      if (seg) { seg.style.opacity = state.duckOn ? '1' : '.4'; seg.style.pointerEvents = state.duckOn ? '' : 'none'; }
      if (isPlaying()) scheduleDuckNow(getPos());
      renderRules();
      drawAll();
    });

    root.querySelectorAll('#duck-mode-seg button').forEach(b => {
      b.addEventListener('click', () => {
        state.duckMode = b.dataset.m;
        root.querySelectorAll('#duck-mode-seg button').forEach(x => x.classList.toggle('active', x === b));
        if (isPlaying()) scheduleDuckNow(getPos());
        renderRules();
        drawAll();
      });
    });

    root.querySelectorAll('.radio-card[data-f]').forEach(c => {
      c.addEventListener('click', () => {
        state.format = c.dataset.f;
        root.querySelectorAll('.radio-card[data-f]').forEach(x => x.classList.toggle('active', x === c));
      });
    });

    ui.playBtn?.addEventListener('click', () => {
      if (isPlaying()) pauseAll();
      else playAll();
      refreshTransport();
    });
    document.getElementById('mix-stop')?.addEventListener('click', () => {
      stopAll();
      scheduleDuckNow(0);
      refreshTransport();
      drawAll();
    });

    document.getElementById('save-btn')?.addEventListener('click', () => doSave());
    document.getElementById('export-btn')?.addEventListener('click', doExport);
  }

  // 规则区局部刷新（避免整页重渲染打断滑块拖动）
  function renderRules() {
    const box = document.getElementById('rules-box');
    if (!box) return;
    box.innerHTML = computeRules().map(r =>
      `<span class="rule-tag"><i style="background:${r.color}"></i>${r.text}</span>`).join('');
  }

  // ---------- 波形绘制 ----------

  function duckRegionList() {
    if (!duckActive()) return [];
    return duckSegments().map(s => ({ start: s.start, end: s.end, color: 'rgba(230,178,90,0.25)' }));
  }

  function drawAll() {
    const pos = getPos();
    if (ui.voiceCanvas && state.voiceTrack) {
      AudioEngine.drawBuffer(ui.voiceCanvas, state.voiceTrack.buffer, {
        progressSec: pos,
        color: '#3a4258', playedColor: '#b28cff',
        regions: state.voiceTrack.silences.map(s => ({ start: s.start, end: s.end, color: 'rgba(120,130,160,0.16)' })),
      });
    }
    if (ui.bgmCanvas && state.effectiveBgm) {
      AudioEngine.drawBuffer(ui.bgmCanvas, state.effectiveBgm, {
        progressSec: pos,
        color: '#3a4258', playedColor: '#e6b25a',
        regions: duckRegionList(),
      });
    }
  }

  function refreshTransport() {
    if (ui.playBtn) {
      ui.playBtn.innerHTML = isPlaying() ? Layout.icons.pause : Layout.icons.play;
      ui.playBtn.disabled = !voicePlayer.buffer && !bgmPlayer.buffer;
    }
    if (ui.timeEl) {
      ui.timeEl.innerHTML = `<b>${Util.fmtTime(getPos())}</b> / ${Util.fmtTime(timelineDur())}`;
    }
  }

  function startLoop() {
    if (rafId != null) return;
    const tick = () => {
      const pos = getPos();
      if (isPlaying() && timelineDur() > 0 && pos >= timelineDur() - 0.06) {
        stopAll();
        scheduleDuckNow(0);
        drawAll();
        refreshTransport();
        rafId = null;
        return;
      }
      drawAll();
      refreshTransport();
      if (isPlaying()) rafId = requestAnimationFrame(tick);
      else { rafId = null; }
    };
    rafId = requestAnimationFrame(tick);
  }

  // ---------- 入库与导出 ----------

  function buildMixArtifact() {
    const id = state.savedId || Util.uid();
    const vName = state.voiceTrack ? state.voiceTrack.artifact.name.replace('人声 · ', '') : null;
    const bName = state.bgmTrack ? state.bgmTrack.artifact.name.replace('背景音 · ', '') : null;
    const trackNames = [vName, bName].filter(Boolean).join(' + ') || '空轨';
    return {
      id,
      type: 'mix',
      name: `成品 · ${trackNames}`,
      createdAt: state.savedId ? undefined : Date.now(),
      params: {
        hasVoice: !!state.voiceTrack,
        hasBgm: !!state.bgmTrack,
        voiceArtId: state.voiceTrack ? state.voiceTrack.artifact.id : null,
        bgmArtId: state.bgmTrack ? state.bgmTrack.artifact.id : null,
        voiceVol: state.voiceVol,
        bgmVol: state.bgmVol,
        offset: state.voiceTrack && state.bgmTrack ? state.offset : 0,
        duckMode: duckActive() ? state.duckMode : 'off',
        format: state.format,
        rules: computeRules().map(r => r.text),
      },
      content: {},
    };
  }

  function doSave(silent = false) {
    if (!state.voiceTrack && !state.bgmTrack) return null;
    const artifact = buildMixArtifact();
    Store.save(artifact);
    state.savedId = artifact.id;
    if (!silent) { render(); Util.toast('成品已存入产物库', 'success'); }
    return artifact;
  }

  async function doExport() {
    if (state.exporting) return;
    stopAll();
    state.exporting = true;
    render();
    await new Promise(r => setTimeout(r, 1400 + Math.random() * 600));
    const artifact = doSave(true);
    state.exporting = false;
    render();
    const ext = state.format === 'mp3' ? 'mp3' : 'wav';
    const file = `${artifact.name}.${ext}`;
    const mask = Util.el(`
      <div class="modal-mask">
        <div class="modal" style="max-width:420px">
          <div class="modal-head"><h3>导出成功（示意）</h3></div>
          <div class="modal-body">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <span style="width:34px;height:34px;border-radius:50%;background:var(--teal-soft);color:var(--teal);display:flex;align-items:center;justify-content:center;flex-shrink:0">${Layout.icons.check}</span>
              <span class="mono text-sm">${Util.escapeHtml(file)}</span>
            </div>
            <div class="text-sm text-dim">格式：${state.format === 'mp3' ? 'MP3 320kbps' : 'WAV 16bit / 44.1kHz'} · 时长 ${Util.fmtTime(timelineDur())}<br>原型不产出真实文件，成品参数已存入产物库。</div>
          </div>
          <div class="modal-foot"><button class="btn primary" data-act="ok">好的</button></div>
        </div>
      </div>`);
    document.body.appendChild(mask);
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-act="ok"]')) mask.remove();
    });
    Util.toast('成品已导出并入库（示意）', 'success');
  }

  // ---------- 初始化 ----------

  const handoff = Store.takeHandoff('mixdown');
  if (handoff) {
    const art = Store.get(handoff.artifactId);
    if (art) {
      if (art.type === 'voice') state.voiceArtId = art.id;
      else if (art.type === 'bgm') state.bgmArtId = art.id;
    }
  }

  // 若未通过交接进入且库里有产物，自动预选最新的人声与背景音
  if (!handoff) {
    const v = Store.list('voice')[0];
    const b = Store.list('bgm')[0];
    if (v) state.voiceArtId = v.id;
    if (b) state.bgmArtId = b.id;
  }

  if (state.voiceArtId !== 'none' || state.bgmArtId !== 'none') {
    loadTracks();
  } else {
    render();
  }
})();
