/* ============================================================
   设置页：大模型统一配置（模型池模式，tab 布局）
   Tab：文本生成 / 语音合成 / 音乐生成（同产物库 tab 形态）
   每类：启用模型（开关）+ 默认模型（点击卡片）
        + 每模型 Model ID 与 API Key（纯本地示意）
   全部选中即保存（无保存按钮），Store 持久化
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  // 三类配置（key 对应 Store settings 结构；models 为该类模型库）
  const CATEGORIES = [
    { key: 'text',  title: '文本生成', desc: '冥想 / 播客剧本生成使用', models: () => Mock.LLM_MODELS },
    { key: 'tts',   title: '语音合成', desc: 'TTS 人声合成使用',         models: () => Mock.TTS_ENGINES },
    { key: 'music', title: '音乐生成', desc: '背景音 / 纯音乐生成使用',   models: () => Mock.MUSIC_MODELS },
  ];

  let settings = Store.getSettings();
  let tab = 'text';        // 当前激活的 tab（key）
  let keyTimer = null;     // 输入防抖保存（API Key / Model ID 共用）

  // ---------- 渲染 ----------

  function render() {
    const cat = CATEGORIES.find(c => c.key === tab);
    root.innerHTML = `
      <div class="tabs" style="margin-bottom:0;border:none">
        ${CATEGORIES.map(c => `
          <button class="tab ${tab === c.key ? 'active' : ''}" data-tab="${c.key}">
            ${c.title}<span class="cnt">${settings[c.key].enabled.length}</span>
          </button>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">${cat.title}</div>
        <div class="card-desc">${cat.desc}</div>
        <div class="model-list">
          ${cat.models().map(m => renderModelCard(cat.key, settings[cat.key], m)).join('')}
        </div>
      </div>`;
    bind();
  }

  function renderModelCard(catKey, conf, m) {
    const enabled = conf.enabled.includes(m.id);
    const isDefault = conf.default === m.id;
    return `
      <div class="model-card ${enabled ? 'on' : ''} ${isDefault ? 'default' : ''}" data-cat="${catKey}" data-model="${m.id}">
        <div class="mc-main" title="${enabled ? '点击设为默认模型' : '启用后可设为默认'}">
          <div class="mc-head">
            <span class="mc-name">${m.name}</span>
            ${isDefault ? '<span class="mc-default">默认</span>' : ''}
            <span class="switch"><input type="checkbox" data-toggle="${m.id}" ${enabled ? 'checked' : ''}><span class="track"></span></span>
          </div>
          <div class="mc-meta">${m.provider || ''} · ${m.desc || ''}</div>
        </div>
        ${enabled ? `
          <div class="mc-fields">
            <label class="mc-field">
              <span class="mc-field-label">Model ID</span>
              <input class="input mc-input" type="text" placeholder="${m.mid || 'model-id'}"
                     value="${Util.escapeHtml(conf.modelIds[m.id] || '')}" data-mid="${m.id}">
            </label>
            <label class="mc-field">
              <span class="mc-field-label">API Key</span>
              <input class="input mc-input" type="text" placeholder="sk-…（示意）"
                     value="${Util.escapeHtml(conf.keys[m.id] || '')}" data-key="${m.id}">
            </label>
          </div>` : ''}
      </div>`;
  }

  // ---------- 事件 ----------

  function bind() {
    // tab 切换（不重渲染其他状态）
    root.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.addEventListener('click', () => {
        tab = t.dataset.tab;
        render();
      });
    });

    // 卡片主体点击 → 设为默认（仅已启用模型；开关与输入框不触发）
    root.querySelectorAll('.model-card.on .mc-main').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.switch')) return;
        const card = el.closest('.model-card');
        setDefault(card.dataset.cat, card.dataset.model);
      });
    });

    // 启用开关（每类至少保留一个；禁用默认模型时默认自动转移）
    root.querySelectorAll('input[data-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        const card = cb.closest('.model-card');
        toggleModel(card.dataset.cat, card.dataset.model, cb.checked);
      });
    });

    // 输入类：Model ID / API Key（防抖保存，仅本地示意）
    root.querySelectorAll('input[data-mid], input[data-key]').forEach(inp => {
      inp.addEventListener('input', () => {
        clearTimeout(keyTimer);
        keyTimer = setTimeout(() => {
          const card = inp.closest('.model-card');
          const val = inp.value.trim();
          if (inp.dataset.mid) saveMid(card.dataset.cat, card.dataset.model, val);
          else saveKey(card.dataset.cat, card.dataset.model, val);
        }, 500);
      });
      // 阻止输入冒泡触发卡片点击
      inp.addEventListener('click', e => e.stopPropagation());
    });
  }

  // ---------- 操作（选中即保存） ----------

  function setDefault(catKey, modelId) {
    const conf = settings[catKey];
    if (conf.default === modelId) return;
    conf.default = modelId;
    settings = Store.saveSettings(catKey, { default: modelId });
    render();
    Util.toast(`已将「${modelName(catKey, modelId)}」设为默认`, 'success');
  }

  function toggleModel(catKey, modelId, on) {
    const conf = settings[catKey];
    if (on) {
      if (!conf.enabled.includes(modelId)) {
        conf.enabled.push(modelId);
        settings = Store.saveSettings(catKey, { enabled: conf.enabled.slice() });
        render();
        Util.toast(`已启用「${modelName(catKey, modelId)}」`, 'success');
      }
      return;
    }
    // 禁用：每类至少保留一个启用模型
    if (conf.enabled.length <= 1) {
      Util.toast('每类至少保留一个启用的模型', 'error');
      render();   // 回滚开关视觉态
      return;
    }
    conf.enabled = conf.enabled.filter(x => x !== modelId);
    let toastExtra = '';
    if (conf.default === modelId) {
      conf.default = conf.enabled[0];
      toastExtra = `，默认已切换为「${modelName(catKey, conf.default)}」`;
    }
    settings = Store.saveSettings(catKey, { enabled: conf.enabled.slice(), default: conf.default });
    render();
    Util.toast(`已禁用「${modelName(catKey, modelId)}」${toastExtra}`, 'success');
  }

  function saveMid(catKey, modelId, val) {
    const conf = settings[catKey];
    conf.modelIds[modelId] = val;
    settings = Store.saveSettings(catKey, { modelIds: { ...conf.modelIds } });
    Util.toast('Model ID 已保存（本地示意）', 'success');
  }

  function saveKey(catKey, modelId, val) {
    const conf = settings[catKey];
    conf.keys[modelId] = val;
    settings = Store.saveSettings(catKey, { keys: { ...conf.keys } });
    Util.toast('API Key 已保存（本地示意）', 'success');
  }

  function modelName(catKey, modelId) {
    const cat = CATEGORIES.find(c => c.key === catKey);
    return (cat.models().find(m => m.id === modelId) || {}).name || modelId;
  }

  render();
})();
