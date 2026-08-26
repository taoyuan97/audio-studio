/* ============================================================
   背景音 / 纯音乐生成页（Agent 对话式输入）
   左栏：自然语言对话 + 时长滑块 + 格式 + 音乐模型切换
         → 模拟纯音乐合成（风格/结构/融合由消息解析）
   右栏：音轨波形试听 → 入库 / 送最终合成
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  const GEN_STEPS = [
    '解析风格与融合指令',
    '生成和弦进行与配器方案',
    '构建段落能量包络',
    '渲染纯音乐音轨',
    '响度归一与格式封装',
  ];

  const STRUCTURE_OPTIONS = [
    { id: 'intro', label: 'Intro' },
    { id: 'buildup', label: 'Build Up' },
    { id: 'drop', label: 'Drop' },
    { id: 'outro', label: 'Outro' },
  ];

  const SUGGESTIONS = [
    '来一段古风禅意的背景音乐，加上笛子和雨声',
    '做一段自然氛围的冥想背景音，要有海浪声',
    '来点电子氛围的专注工作背景音',
  ];

  // 全局设置：音乐生成模型池（设置页配置；默认模型为初始值，页内切换不回写全局）
  const MODEL_POOL = (() => {
    const s = Store.getSettings().music;
    const options = Mock.MUSIC_MODELS.filter(m => s.enabled.includes(m.id));
    const initial = options.some(m => m.id === s.default) ? s.default : options[0].id;
    return { options, initial };
  })();

  const state = {
    messages: [],        // [{ role: 'user'|'ai', text, pending?, meta? }]
    model: MODEL_POOL.initial, // 音乐模型 id（见 Mock.MUSIC_MODELS / 设置页）
    format: 'mp3',
    input: '',
    duration: 3,
    popover: null,       // 当前打开的参数浮层：null | 'duration' | 'format'
    generating: false,
    stepDone: 0,
    progress: 0,
    result: null,        // { buffer, sections, params, fusionNote }
    savedId: null,
  };

  const player = new AudioEngine.BufferPlayer();
  const ui = {};
  let rafId = null;

  // ---------- 渲染 ----------

  function render() {
    state.popover = null;   // 重建 DOM 后浮层默认关闭
    root.innerHTML = `
      <div class="grid-2">
        <div class="card chat-card">
          <div class="chat-head">
            <div class="card-title">对话生成</div>
            <div class="card-desc">描述你想要的背景音乐：风格、氛围、融合元素、段落结构。我会自动解析并渲染纯音乐音轨。</div>
          </div>
          <div class="chat-body" id="chat-body">${renderChatBody()}</div>
          ${renderComposer()}
        </div>
        <div>
          <div class="card" id="result-card">${renderResultArea()}</div>
        </div>
      </div>`;
    bind();
    if (state.result) drawWave();
    refreshTransport();
  }

  function renderComposer() {
    return `
      <div class="chat-composer">
        <div class="composer-box">
          <textarea class="chat-input" id="chat-input" rows="1"
            placeholder="描述你想要的背景音乐：风格、氛围、融合元素、段落结构……">${Util.escapeHtml(state.input)}</textarea>
        </div>
        <div class="composer-foot">
          <div class="composer-tools">
            <div class="chip-wrap" data-pop="duration">
              <button class="chip-btn" id="duration-chip" title="目标时长">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                <span id="duration-chip-val">${state.duration} 分钟</span>
              </button>
              <div class="popover" id="duration-pop">
                <div class="pop-title">目标时长</div>
                <div class="pop-slider">
                  <input type="range" id="duration-slider" min="1" max="10" step="1" value="${state.duration}">
                  <span class="slider-value" id="duration-val">${state.duration} 分钟</span>
                </div>
              </div>
            </div>
            <div class="chip-wrap" data-pop="format">
              <button class="chip-btn" id="format-chip" title="导出格式">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>
                <span id="format-chip-val">${state.format.toUpperCase()}</span>
              </button>
              <div class="popover" id="format-pop">
                <div class="pop-title">导出格式</div>
                ${[['mp3', 'MP3', '通用压缩格式，体积小'], ['wav', 'WAV', '无损原始质量，体积大']].map(([id, label, desc]) => `
                  <button class="pop-option ${state.format === id ? 'active' : ''}" data-f="${id}">
                    <span class="po-check">${state.format === id ? Layout.icons.check : ''}</span>
                    <span>${label}<span class="po-desc">${desc}</span></span>
                  </button>`).join('')}
              </div>
            </div>
            <select class="select model-select" id="model-select" title="音乐生成模型">
              ${MODEL_POOL.options.map(m => `<option value="${m.id}" ${state.model === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
            </select>
          </div>
          <span class="composer-tip">Enter 发送 · Shift+Enter 换行</span>
          <button class="send-btn" id="send-btn" ${(!state.input.trim() || state.generating) ? 'disabled' : ''} title="发送">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>
          </button>
        </div>
      </div>`;
  }

  function renderChatBody() {
    if (!state.messages.length) {
      return `
        <div class="chat-empty">
          <div class="ce-icon">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>
          </div>
          <div class="ce-title">聊聊你想要的背景音乐</div>
          <div class="ce-desc">说出风格与氛围，可融合乐器或环境声（笛箫、电子、雨声、海浪），<br>还可以描述段落结构（前奏、递进、高潮、收尾）。试试下面的例子：</div>
          <div class="suggest-list">
            ${SUGGESTIONS.map(s => `<button class="suggest-item" data-suggest="${Util.escapeHtml(s)}">${Util.escapeHtml(s)}</button>`).join('')}
          </div>
        </div>`;
    }
    return state.messages.map(m => m.role === 'user' ? renderUserMsg(m) : renderAiMsg(m)).join('');
  }

  function renderUserMsg(m) {
    return `<div class="msg user"><div class="msg-bubble">${Util.escapeHtml(m.text)}</div></div>`;
  }

  function renderAiMsg(m) {
    if (m.pending) {
      const step = GEN_STEPS[Math.min(state.stepDone, GEN_STEPS.length - 1)];
      return `
        <div class="msg ai">
          <div class="msg-bubble">
            <span class="typing"><i></i><i></i><i></i></span>
            <span class="typing-text">${step}…</span>
          </div>
        </div>`;
    }
    const meta = m.meta || {};
    return `
      <div class="msg ai">
        <div class="msg-bubble">${Util.escapeHtml(m.text)}</div>
        <div class="msg-meta"><span class="model-tag">${Util.escapeHtml(meta.modelName || '')}</span></div>
      </div>`;
  }

  // 只更新消息流与结果卡（不动 composer，保留输入框焦点与草稿）
  function refreshDynamic() {
    const body = document.getElementById('chat-body');
    if (body) { body.innerHTML = renderChatBody(); scrollChatBottom(); }
    const card = document.getElementById('result-card');
    if (card) { card.innerHTML = renderResultArea(); bindResultArea(); }
    if (state.result && !state.generating) { drawWave(); refreshTransport(); }
  }

  function scrollChatBottom() {
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function renderResultArea() {
    if (state.generating) {
      return `
        <div class="card-title">生成中</div>
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
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>
          <div class="es-title">尚未生成音轨</div>
          <div class="es-desc">在左侧对话中描述风格、时长与结构并发送<br>音轨可单独保存，或直接送去最终合成</div>
        </div>`;
    }
    const p = state.result.params;
    const style = Mock.styleById(p.styleId);
    const structLabel = p.structure.length
      ? p.structure.map(id => STRUCTURE_OPTIONS.find(o => o.id === id).label).join(' / ')
      : '均匀结构（Loop）';
    return `
      <div class="flex-between mb-8">
        <div class="card-title mb-0">背景音轨</div>
        <span class="type-badge tb-bgm">背景音</span>
      </div>
      <div class="param-chips mb-16">
        <span class="param-chip">风格：${style.name}</span>
        <span class="param-chip">时长：${p.duration} 分钟</span>
        <span class="param-chip">结构：${structLabel}</span>
        <span class="param-chip">格式：${p.format.toUpperCase()}</span>
        ${p.fusionText ? `<span class="param-chip">融合：${Util.escapeHtml(p.fusionText)}</span>` : ''}
      </div>
      ${state.result.fusionNote ? `
        <div class="note" style="margin-top:0;margin-bottom:14px">
          ${Layout.icons.info}<span>${Util.escapeHtml(state.result.fusionNote)}</span>
        </div>` : ''}
      <div class="wave-panel">
        <div class="wave-label"><span>音轨波形（段落结构已标注）</span><span>${Util.fmtTime(player.duration)}</span></div>
        <canvas class="wave" id="bgm-canvas"></canvas>
        <div class="transport">
          <button class="play-btn" id="bgm-play"></button>
          <span class="time-display" id="bgm-time"><b>00:00</b> / ${Util.fmtTime(player.duration)}</span>
          <span class="transport-note">占位合成音（Web Audio 演示，非真实音乐生成）</span>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn small" id="save-btn">${state.savedId ? '已存入产物库' : '存入产物库'}</button>
        <span style="flex:1"></span>
        <button class="btn small primary" id="to-mix-btn">送去最终合成 ${Layout.icons.arrow}</button>
      </div>`;
  }

  // ---------- 事件 ----------

  // 参数浮层开关（同时只开一个；render 重建 DOM 后默认全关）
  function setPopover(key) {
    state.popover = key;
    root.querySelectorAll('.chip-wrap').forEach(w => {
      const isOpen = w.dataset.pop === key;
      w.querySelector('.chip-btn')?.classList.toggle('open', isOpen);
      w.querySelector('.popover')?.classList.toggle('show', isOpen);
    });
  }

  // 点击浮层外部 / Esc 关闭（document 级监听挂一次，render 重建 DOM 不影响）
  document.addEventListener('click', e => {
    if (!e.target.closest('.chip-wrap')) setPopover(null);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setPopover(null);
  });

  function bind() {
    // 消息流（建议提示词：点击填入输入框，可修改后发送）
    root.querySelectorAll('.suggest-item').forEach(item => {
      item.addEventListener('click', () => {
        state.input = item.dataset.suggest;
        const ta = document.getElementById('chat-input');
        if (ta) {
          ta.value = state.input;
          fitTextarea(ta);
          ta.focus();
        }
        updateSendBtn();
      });
    });

    // 输入框：自适应高度 + 受控文本
    const ta = document.getElementById('chat-input');
    if (ta) {
      ta.addEventListener('input', e => {
        state.input = e.target.value;
        fitTextarea(e.target);
        updateSendBtn();
      });
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
      fitTextarea(ta);
    }

    // 目标时长（chip 点击弹出滑块浮层；拖动即时生效，浮层保持打开便于微调）
    const durChip = document.getElementById('duration-chip');
    if (durChip) durChip.addEventListener('click', () => {
      setPopover(state.popover === 'duration' ? null : 'duration');
    });
    const durSlider = document.getElementById('duration-slider');
    durSlider?.addEventListener('input', e => {
      state.duration = parseInt(e.target.value, 10);
      const v = document.getElementById('duration-val');
      if (v) v.textContent = state.duration + ' 分钟';
      const chipVal = document.getElementById('duration-chip-val');
      if (chipVal) chipVal.textContent = state.duration + ' 分钟';
    });

    // 导出格式（chip 点击弹出选项浮层；选择即完成自动收起；仅意向记录不影响试听）
    const fmtChip = document.getElementById('format-chip');
    if (fmtChip) fmtChip.addEventListener('click', () => {
      setPopover(state.popover === 'format' ? null : 'format');
    });
    root.querySelectorAll('#format-pop .pop-option').forEach(opt => {
      opt.addEventListener('click', () => {
        state.format = opt.dataset.f;
        const chipVal = document.getElementById('format-chip-val');
        if (chipVal) chipVal.textContent = state.format.toUpperCase();
        root.querySelectorAll('#format-pop .pop-option').forEach(x => {
          const active = x.dataset.f === state.format;
          x.classList.toggle('active', active);
          const chk = x.querySelector('.po-check');
          if (chk) chk.innerHTML = active ? Layout.icons.check : '';
        });
        setPopover(null);
      });
    });

    // 音乐模型切换（影响下次生成的气泡徽标与产物 params）
    const modelSel = document.getElementById('model-select');
    if (modelSel) modelSel.addEventListener('change', e => { state.model = e.target.value; });

    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    // 结果区（局部刷新后会重新绑定）
    bindResultArea();
  }

  // 结果区绑定（含播放器 UI 引用；refreshDynamic 局部刷新后需重新绑定）
  function bindResultArea() {
    ui.canvas = document.getElementById('bgm-canvas');
    ui.playBtn = document.getElementById('bgm-play');
    ui.timeEl = document.getElementById('bgm-time');

    ui.playBtn?.addEventListener('click', () => {
      if (player.playing) player.pause();
      else player.play();
      refreshTransport();
      startLoop();
    });

    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => doSave());

    const mixBtn = document.getElementById('to-mix-btn');
    if (mixBtn) mixBtn.addEventListener('click', () => {
      const art = doSave(true);
      Store.setHandoff({ target: 'mixdown', artifactId: art.id });
      location.href = 'mixdown.html';
    });
  }

  function updateSendBtn() {
    const btn = document.getElementById('send-btn');
    if (btn) btn.disabled = !state.input.trim() || state.generating;
  }

  function fitTextarea(t) {
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 108) + 'px';
  }

  // ---------- 生成 ----------

  async function sendMessage() {
    const text = state.input.trim();
    if (!text || state.generating) return;

    // 自然语言解析：风格（关键词匹配）/ 段落结构 / 跨风格融合指令
    const { style, matched } = Mock.matchStyle(text);
    const structure = Mock.parseStructure(text);
    const fusion = Mock.resolveFusion(text);

    state.messages.push({ role: 'user', text });
    state.input = '';
    state.generating = true;
    state.stepDone = 0;
    state.progress = 0;
    state.messages.push({ role: 'ai', pending: true });   // 占位气泡，完成后填充摘要
    player.stop();
    render();

    // 音频渲染与进度动画并行进行
    const renderPromise = AudioEngine.renderMusic({
      style, fusion, duration: state.duration * 60, structure,
      seedKey: `${style.id}|${fusion.note}|${state.duration}|${structure.join(',')}`,
    });

    await Mock.fakeTask(GEN_STEPS, {
      minMs: 1600, maxMs: 2400,
      onStep: i => {
        state.stepDone = i;
        state.progress = Math.round((i / GEN_STEPS.length) * 100);
        refreshDynamic();
      },
    });

    const { buffer, sections } = await renderPromise;
    player.setBuffer(buffer);
    const modelName = Mock.musicModelById(state.model).name;
    state.result = {
      buffer, sections,
      params: {
        styleId: style.id, styleName: style.name,
        fusionText: fusion.note,                       // 融合摘要（如「笛箫旋律线 + 环境底噪」）
        duration: state.duration, structure: structure.slice(),
        format: state.format, model: state.model, modelName, input: text,
      },
      fusionNote: fusion.note ? `融合指令已生效：${fusion.note}` : '',
      styleMatched: matched,
    };
    state.savedId = null;
    state.generating = false;

    // 填充 assistant 摘要气泡（不重复渲染音频信息，右栏是唯一结果区）
    const structLabel = structure.length
      ? `结构：${structure.map(id => STRUCTURE_OPTIONS.find(o => o.id === id).label).join(' / ')}`
      : '结构：均匀 Loop';
    const fusionPart = fusion.note ? `，融合：${fusion.note}` : '';
    const aiMsg = state.messages[state.messages.length - 1];
    aiMsg.pending = false;
    aiMsg.text = matched
      ? `已生成「${style.name}」背景音轨 —— ${state.duration} 分钟，${structLabel}${fusionPart}。可在右侧试听，或直接送去最终合成。`
      : `未识别到具体风格，已按默认「${style.name}」生成背景音轨 —— ${state.duration} 分钟，${structLabel}${fusionPart}。可在右侧试听，或直接送去最终合成。`;
    aiMsg.meta = { model: state.model, modelName, styleName: style.name, duration: state.duration };

    refreshDynamic();
    drawWave();
    refreshTransport();
    const ta = document.getElementById('chat-input');
    if (ta) { fitTextarea(ta); ta.focus(); }
    updateSendBtn();
    Util.toast(`音轨生成完成（${Util.fmtTime(buffer.duration)}）`, 'success');
  }

  function doSave(silent = false) {
    if (!state.result) return null;
    const id = state.savedId || Util.uid();
    const p = state.result.params;
    const artifact = {
      id,
      type: 'bgm',
      name: `背景音 · ${p.styleName}（${p.duration}分钟）`,
      createdAt: state.savedId ? undefined : Date.now(),
      params: { ...p },
      content: {},
    };
    Store.save(artifact);
    state.savedId = id;
    if (!silent) { render(); Util.toast('已存入产物库', 'success'); }
    return artifact;
  }

  // ---------- 播放 UI ----------

  function drawWave() {
    if (!ui.canvas || !state.result) return;
    AudioEngine.drawBuffer(ui.canvas, state.result.buffer, {
      progressSec: player.playing || player.position > 0 ? player.position : null,
      color: '#3a4258', playedColor: '#e6b25a',
      regions: state.result.sections
        .filter(s => s.name !== 'Loop')
        .map(s => ({ start: s.start, end: s.end, color: 'rgba(230,178,90,0.06)', label: s.name, labelColor: '#e6b25a' })),
    });
  }

  function refreshTransport() {
    if (ui.playBtn) {
      ui.playBtn.innerHTML = player.playing ? Layout.icons.pause : Layout.icons.play;
      ui.playBtn.disabled = !player.buffer;
    }
    if (ui.timeEl) {
      ui.timeEl.innerHTML = `<b>${Util.fmtTime(player.position)}</b> / ${Util.fmtTime(player.duration)}`;
    }
  }

  function startLoop() {
    if (rafId != null) return;
    const tick = () => {
      drawWave();
      refreshTransport();
      if (player.playing) rafId = requestAnimationFrame(tick);
      else { rafId = null; drawWave(); refreshTransport(); }
    };
    rafId = requestAnimationFrame(tick);
  }

  player.onEnded = () => { refreshTransport(); startLoop(); };

  render();
})();
