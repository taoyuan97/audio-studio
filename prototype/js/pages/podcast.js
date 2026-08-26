/* ============================================================
   播客剧本生成页（Agent 对话式输入）
   左栏：自然语言对话 + 分钟参数 + 大模型切换 → 模拟生成
         话题生成 / 文本润色由意图识别自动选择（无模式控件）
   右栏：单人讲述脚本 → 预览/编辑/入库/送 TTS
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  const GEN_STEPS = {
    topic: ['解析话题关键词', '注入播客专用 Prompt 模板', '生成开场引入与主体内容', '撰写总结收尾'],
    text: ['解析原文结构', '提取核心要点', '口语化润色改编', '补充开场引入与收尾'],
  };

  const SUGGESTIONS = [
    '帮我写一期关于 AI 时代学习方法的单人播客',
    '聊聊城市漫步的意义',
    '做一期关于早起习惯的分享',
  ];

  // 目标时长档位（chip 按钮点击弹出浮层选择）
  const DURATION_OPTIONS = [
    { d: 5, desc: '轻量分享' },
    { d: 15, desc: '标准单集' },
    { d: 30, desc: '深度话题' },
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
    genMode: 'topic',      // 本次发送自动识别的模式（供进度步骤与结果区使用）
    stepDone: 0,
    progress: 0,
    result: null,          // { mode, text, note, topic, input }
    editing: false,
    draft: '',
    savedId: null,
    dirty: false,
  };

  // ---------- 渲染 ----------

  function render() {
    state.popover = null;   // 重建 DOM 后浮层默认关闭
    root.innerHTML = `
      <div class="grid-2">
        <div class="card chat-card">
          <div class="chat-head">
            <div class="card-title">对话生成</div>
            <div class="card-desc">告诉我一个话题，或直接粘贴一段文本。我会自动选择方式：话题生成单人讲述脚本，长文本润色改编为口播稿。</div>
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
            placeholder="描述你的话题，或直接粘贴一段文本让我润色改编">${Util.escapeHtml(state.input)}</textarea>
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
          <div class="ce-icon">${Layout.icons.podcast}</div>
          <div class="ce-title">聊聊你想做的一期播客</div>
          <div class="ce-desc">给我一个话题，我会生成开场引入 → 主体内容 → 总结收尾的单人讲述脚本；<br>粘贴已有文本，我会润色改编为口语化口播稿。试试下面的例子：</div>
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
      const steps = GEN_STEPS[state.genMode];
      const step = steps[Math.min(state.stepDone, steps.length - 1)];
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
      const steps = GEN_STEPS[state.genMode];
      return `
        <div class="card-title">生成中</div>
        <div class="gen-panel">
          ${steps.map((s, i) => `
            <div class="gen-step ${i < state.stepDone ? 'done' : i === state.stepDone ? 'active' : ''}">
              <span class="gs-icon">${i < state.stepDone ? Layout.icons.check : ''}</span>${s}
            </div>`).join('')}
          <div class="progress"><div class="bar" style="width:${state.progress}%"></div></div>
        </div>`;
    }
    if (!state.result) {
      return `
        <div class="empty-state">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
          <div class="es-title">尚未生成脚本</div>
          <div class="es-desc">在左侧对话中描述话题或粘贴文本并发送<br>生成结果可编辑、存入产物库，或直接送去 TTS 合成</div>
        </div>`;
    }
    const { text, note, mode } = state.result;
    const syls = AudioEngine.countSyllables(text);
    const estSec = syls * 0.33;
    const wordCount = text.replace(/\s/g, '').length;
    const isEdited = state.dirty;

    return `
      <div class="flex-between mb-8">
        <div class="card-title mb-0">生成结果</div>
        <span class="type-badge tb-script-podcast">播客脚本</span>
      </div>
      <div class="param-chips mb-16">
        <span class="param-chip">${mode === 'topic' ? '话题生成' : '文本润色改编'}</span>
        <span class="param-chip">目标时长：${state.duration} 分钟</span>
        <span class="param-chip">正文：${wordCount} 字</span>
        <span class="param-chip">预计口播：约 ${Math.max(1, Math.round(estSec / 60))} 分钟</span>
        ${isEdited ? '<span class="param-chip" style="color:var(--amber)">已编辑</span>' : ''}
      </div>
      <div class="note" style="margin-top:0;margin-bottom:14px">
        ${Layout.icons.info}
        <span>${Util.escapeHtml(note || '')}</span>
      </div>
      ${state.editing ? `
        <textarea class="script-edit" id="script-editor">${Util.escapeHtml(state.draft)}</textarea>
        <div class="field-hint">播客脚本为自然讲述文本，无需特殊标记；编辑后保存即可。</div>
      ` : `
        <div class="script-view">${Util.renderScript(text)}</div>
      `}
      <div class="btn-row">
        <button class="btn small" id="edit-btn">${state.editing ? '完成编辑' : '编辑脚本'}</button>
        <button class="btn small" id="save-btn">${state.savedId && !state.dirty ? '已存入产物库' : '存入产物库'}</button>
        <span style="flex:1"></span>
        <button class="btn small primary" id="to-tts-btn">送去 TTS 合成 ${Layout.icons.arrow}</button>
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

    // 结果区（局部刷新后会重新绑定）
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

    // 意图识别：话题生成 / 文本润色（自动选择，无模式控件）
    const intent = Mock.classifyPodcastIntent(text);

    state.messages.push({ role: 'user', text });
    state.input = '';
    state.generating = true;
    state.genMode = intent;
    state.stepDone = 0;
    state.progress = 0;
    state.editing = false;
    state.messages.push({ role: 'ai', pending: true });   // 占位气泡，完成后填充摘要
    render();

    // 进度动画（消息流与结果卡同步，composer 保持不动）
    const steps = GEN_STEPS[intent];
    await Mock.fakeTask(steps, {
      minMs: 1500, maxMs: 2300,
      onStep: i => {
        state.stepDone = i;
        state.progress = Math.round((i / steps.length) * 100);
        refreshDynamic();
      },
    });

    const out = Mock.generatePodcast(
      intent === 'topic'
        ? { mode: 'topic', topic: text, duration: state.duration }
        : { mode: 'text', text, duration: state.duration }
    );
    const syls = AudioEngine.countSyllables(out.text);
    const estSec = syls * 0.33;
    const wordCount = out.text.replace(/\s/g, '').length;
    const model = Mock.llmById(state.model);
    const topic = intent === 'topic' ? Mock.extractTopic(text) : '';

    state.result = { mode: intent, text: out.text, note: out.note, topic, input: text, srcLength: out.srcLength };
    state.savedId = null;
    state.dirty = false;
    state.generating = false;

    // 填充 assistant 摘要气泡（不重复渲染脚本正文，右栏是唯一结果区）
    const aiMsg = state.messages[state.messages.length - 1];
    aiMsg.pending = false;
    aiMsg.text = intent === 'topic'
      ? `已围绕「${topic}」生成 ${state.duration} 分钟单人讲述脚本 —— 正文 ${wordCount} 字，预计口播约 ${Math.max(1, Math.round(estSec / 60))} 分钟。可在右侧查看与编辑，或直接送去 TTS 合成。`
      : `已将你的文本（${out.srcLength ?? text.replace(/\s/g, '').length} 字）润色改编为口播脚本 —— 保留核心要点并补充开场收尾。可在右侧查看与编辑，或直接送去 TTS 合成。`;
    aiMsg.meta = { model: state.model, modelName: model.name, mode: intent, topic, duration: state.duration };

    refreshDynamic();
    const ta = document.getElementById('chat-input');
    if (ta) { fitTextarea(ta); ta.focus(); }
    updateSendBtn();
    Util.toast('脚本生成完成', 'success');
  }

  function doSave(silent = false) {
    if (!state.result || !state.result.text) return null;
    const id = state.savedId || Util.uid();
    const isTopic = state.result.mode === 'topic';
    const name = isTopic
      ? `播客脚本 · ${state.result.topic || '话题'}`
      : '播客脚本 · 文本润色';
    const artifact = {
      id,
      type: 'script_podcast',
      name,
      createdAt: state.savedId ? undefined : Date.now(),
      params: isTopic
        ? { mode: 'topic', topic: state.result.topic, duration: state.duration, model: state.model, modelName: Mock.llmById(state.model).name, input: state.result.input }
        : { mode: 'text', sourceLength: state.result.srcLength ?? state.result.input.trim().replace(/\s/g, '').length, duration: state.duration, model: state.model, modelName: Mock.llmById(state.model).name, input: state.result.input },
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
