/* ============================================================
   冥想剧本生成页（Agent 对话式输入）
   左栏：自然语言对话 + 分钟参数 + 大模型切换 → 模拟生成
   右栏：带标记脚本 → 预览/编辑/入库/送 TTS
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  const GEN_STEPS = [
    '解析主题与目标时长',
    '注入冥想专用 Prompt 模板',
    '大模型生成结构化脚本',
    '插入时间轴与情绪标记',
    '敏感词过滤（示意）',
  ];

  const SUGGESTIONS = [
    '帮我生成一段深海放松的引导脚本',
    '最近睡前容易焦虑，想要一段睡眠引导冥想',
    '来一份清晨唤醒的正念练习',
  ];

  // 目标时长档位（chip 按钮点击弹出浮层选择）
  const DURATION_OPTIONS = [
    { d: 5, desc: '快速放松' },
    { d: 15, desc: '标准练习' },
    { d: 30, desc: '深度冥想' },
  ];

  // 全局设置：文本生成模型池（设置页配置；默认模型为初始值，页内切换不回写全局）
  const MODEL_POOL = (() => {
    const s = Store.getSettings().text;
    const options = Mock.LLM_MODELS.filter(m => s.enabled.includes(m.id));
    const initial = options.some(m => m.id === s.default) ? s.default : options[0].id;
    return { options, initial };
  })();

  const state = {
    messages: [],          // [{ role: 'user'|'ai', text, pending?, meta? }]
    model: MODEL_POOL.initial,   // 大模型 id（见 Mock.LLM_MODELS / 设置页）
    input: '',
    duration: 5,
    popover: null,         // 当前打开的参数浮层：null | 'duration'
    generating: false,
    stepDone: 0,           // 进度动画：已完成步骤数
    progress: 0,           // 进度百分比
    result: null,          // { text, matchedTopic }
    editing: false,
    draft: '',             // 编辑中的文本
    savedId: null,         // 已入库的产物 id
    dirty: false,          // 入库后是否又编辑过
  };

  // ---------- 渲染 ----------

  function render() {
    state.popover = null;   // 重建 DOM 后浮层默认关闭
    root.innerHTML = `
      <div class="grid-2">
        <div class="card chat-card">
          <div class="chat-head">
            <div class="card-title">对话生成</div>
            <div class="card-desc">用自然语言描述你想要的冥想主题（场景、情绪、困扰均可），生成结果展示在右侧。</div>
          </div>
          <div class="chat-body" id="chat-body">${renderChatBody()}</div>
          ${renderComposer()}
        </div>
        <div>
          <div class="card" id="result-card">${renderResultArea()}</div>
        </div>
      </div>`;
    bind();
    scrollChatBottom();
  }

  function renderComposer() {
    return `
      <div class="chat-composer">
        <div class="composer-box">
          <textarea class="chat-input" id="chat-input" rows="1"
            placeholder="描述你想要的冥想主题，如：帮我生成一段缓解睡前焦虑的引导脚本">${Util.escapeHtml(state.input)}</textarea>
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
                ${DURATION_OPTIONS.map(o => `
                  <button class="pop-option ${state.duration === o.d ? 'active' : ''}" data-d="${o.d}">
                    <span class="po-check">${state.duration === o.d ? Layout.icons.check : ''}</span>
                    <span>${o.d} 分钟<span class="po-desc">${o.desc}</span></span>
                  </button>`).join('')}
              </div>
            </div>
            <select class="select model-select" id="model-select" title="大模型">
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
          <div class="ce-icon">${Layout.icons.meditation}</div>
          <div class="ce-title">描述你想要的冥想引导</div>
          <div class="ce-desc">我会生成带 [停顿] [情绪] [吸气/呼气] [语速] 标记的结构化脚本，供 TTS 合成识别。<br>试试下面的例子，或直接输入你的需求：</div>
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
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>
          <div class="es-title">尚未生成脚本</div>
          <div class="es-desc">在左侧对话中描述你的主题并发送<br>生成结果可编辑、存入产物库，或直接送去 TTS 合成</div>
        </div>`;
    }
    const { text, matchedTopic } = state.result;
    const segments = AudioEngine.parseScript(text);
    const durs = AudioEngine.segmentDurations(segments, 1);
    const total = durs.reduce((a, b) => a + b, 0);
    const wordCount = text.replace(/\[[^\]]*\]/g, '').replace(/\s/g, '').length;
    const isEdited = state.dirty;

    return `
      <div class="flex-between mb-8">
        <div class="card-title mb-0">生成结果</div>
        <span class="type-badge tb-script-meditation">冥想脚本</span>
      </div>
      <div class="param-chips mb-16">
        <span class="param-chip">主题：${Util.escapeHtml(matchedTopic)}</span>
        <span class="param-chip">目标时长：${state.duration} 分钟</span>
        <span class="param-chip">含停顿口播：约 ${Util.fmtTime(total)}</span>
        <span class="param-chip">正文：${wordCount} 字</span>
        ${isEdited ? '<span class="param-chip" style="color:var(--amber)">已编辑</span>' : ''}
      </div>
      <div class="timeline-wrap">
        <div class="timeline-bar">
          ${segments.map((s, i) => {
            const cls = s.type === 'speech' ? 'tl-speech' : s.type === 'pause' ? 'tl-pause' : 'tl-breath';
            const label = s.type === 'speech'
              ? `语音段 · ${s.text.slice(0, 12)}${s.text.length > 12 ? '…' : ''}`
              : s.type === 'pause' ? `停顿 ${s.seconds}s` : (s.dir === 'in' ? '吸气指引' : '呼气指引');
            return `<div class="tl-seg ${cls}" style="width:${(durs[i] / total * 100).toFixed(2)}%" title="${Util.escapeHtml(label)}"></div>`;
          }).join('')}
        </div>
        <div class="timeline-legend">
          <span><i style="background:#5a74e6"></i>语音段</span>
          <span><i style="background:#2c3450"></i>停顿</span>
          <span><i style="background:#22a388"></i>呼吸指引</span>
          <span style="margin-left:auto">${Util.fmtTime(total)}</span>
        </div>
      </div>
      ${state.editing ? `
        <textarea class="script-edit" id="script-editor">${Util.escapeHtml(state.draft)}</textarea>
        <div class="field-hint">支持标记：[停顿 5s] [情绪:温柔] [吸气] [呼气] [语速:慢速]，保存后时间轴将按最新文本重新解析。</div>
      ` : `
        <div class="script-view">${Util.renderScript(text)}</div>
      `}
      <div class="btn-row">
        <button class="btn small" id="edit-btn">${state.editing ? '完成编辑' : '编辑脚本'}</button>
        <button class="btn small" id="save-btn">${state.savedId && !state.dirty ? '已存入产物库' : '存入产物库'}</button>
        <span style="flex:1"></span>
        <button class="btn small primary" id="to-tts-btn">送去 TTS 合成 ${Layout.icons.arrow}</button>
      </div>
      <div class="note">
        ${Layout.icons.info}
        <span>「目标时长」为需求参数；示意脚本实际口播长度如上（含停顿标记换算）。送去 TTS 将自动存入产物库并在合成页预选。</span>
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

    // 目标时长（chip 点击弹出浮层选择；控件为唯一来源）
    const durChip = document.getElementById('duration-chip');
    if (durChip) durChip.addEventListener('click', () => {
      setPopover(state.popover === 'duration' ? null : 'duration');
    });
    root.querySelectorAll('#duration-pop .pop-option').forEach(opt => {
      opt.addEventListener('click', () => {
        state.duration = parseInt(opt.dataset.d, 10);
        const val = document.getElementById('duration-chip-val');
        if (val) val.textContent = state.duration + ' 分钟';
        root.querySelectorAll('#duration-pop .pop-option').forEach(x => {
          const active = parseInt(x.dataset.d, 10) === state.duration;
          x.classList.toggle('active', active);
          const chk = x.querySelector('.po-check');
          if (chk) chk.innerHTML = active ? Layout.icons.check : '';
        });
        setPopover(null);   // 选择即完成，自动收起
      });
    });

    // 大模型切换（影响下次生成的气泡徽标与产物 params）
    const modelSel = document.getElementById('model-select');
    if (modelSel) modelSel.addEventListener('change', e => { state.model = e.target.value; });

    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    // 结果区（与原实现一致；局部刷新后会重新绑定）
    bindResultArea();
  }

  // 结果区按钮绑定（生成完成后由 refreshDynamic 局部刷新，需重新绑定）
  function bindResultArea() {
    const editBtn = document.getElementById('edit-btn');
    if (editBtn) editBtn.addEventListener('click', () => {
      if (state.editing) {
        const editor = document.getElementById('script-editor');
        state.draft = editor ? editor.value : state.draft;
        state.result.text = state.draft;
        if (state.savedId) state.dirty = true;
      } else {
        state.draft = state.result.text;
      }
      state.editing = !state.editing;
      render();
    });

    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => doSave());

    const ttsBtn = document.getElementById('to-tts-btn');
    if (ttsBtn) ttsBtn.addEventListener('click', () => {
      const art = doSave(true);
      Store.setHandoff({ target: 'tts', artifactId: art.id });
      location.href = 'tts.html';
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

  // ---------- 动作 ----------

  async function sendMessage() {
    const text = state.input.trim();
    if (!text || state.generating) return;

    state.messages.push({ role: 'user', text });
    state.input = '';
    state.generating = true;
    state.stepDone = 0;
    state.progress = 0;
    state.editing = false;
    state.messages.push({ role: 'ai', pending: true });   // 占位气泡，完成后填充摘要
    render();

    // 进度动画（消息流与结果卡同步，composer 保持不动）
    await Mock.fakeTask(GEN_STEPS, {
      minMs: 1500, maxMs: 2300,
      onStep: i => {
        state.stepDone = i;
        state.progress = Math.round((i / GEN_STEPS.length) * 100);
        refreshDynamic();
      },
    });

    const { text: script, matchedTopic } = Mock.generateMeditation({ topic: text, duration: state.duration });
    const segments = AudioEngine.parseScript(script);
    const durs = AudioEngine.segmentDurations(segments, 1);
    const total = durs.reduce((a, b) => a + b, 0);
    const wordCount = script.replace(/\[[^\]]*\]/g, '').replace(/\s/g, '').length;
    const model = Mock.llmById(state.model);

    state.result = { text: script, matchedTopic, topic: text };
    state.savedId = null;
    state.dirty = false;
    state.generating = false;

    // 填充 assistant 摘要气泡（不重复渲染脚本正文，右栏是唯一结果区）
    const aiMsg = state.messages[state.messages.length - 1];
    aiMsg.pending = false;
    aiMsg.text = `已生成「${matchedTopic}」${state.duration} 分钟引导脚本 —— 正文 ${wordCount} 字，含停顿口播约 ${Util.fmtTime(total)}。可在右侧查看与编辑，或直接送去 TTS 合成。`;
    aiMsg.meta = { model: state.model, modelName: model.name, topic: matchedTopic, duration: state.duration };

    refreshDynamic();
    const ta = document.getElementById('chat-input');
    if (ta) { fitTextarea(ta); ta.focus(); }
    updateSendBtn();
    Util.toast('脚本生成完成', 'success');
  }

  function doSave(silent = false) {
    if (!state.result) return null;
    const id = state.savedId || Util.uid();
    const artifact = {
      id,
      type: 'script_meditation',
      name: `冥想脚本 · ${state.result.matchedTopic}（${state.duration}分钟）`,
      createdAt: state.savedId ? undefined : Date.now(),
      params: {
        topic: state.result.topic,
        matchedTopic: state.result.matchedTopic,
        duration: state.duration,
        model: state.model,
        modelName: Mock.llmById(state.model).name,
      },
      content: { text: state.result.text },
    };
    Store.save(artifact);
    state.savedId = id;
    state.dirty = false;
    if (!silent) { render(); Util.toast('已存入产物库', 'success'); }
    return artifact;
  }

  render();
})();
