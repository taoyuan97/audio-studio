/* ============================================================
   产物库页：分类筛选 + 详情查看 + 送下游 + 删除/清空
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  const FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'script_meditation', label: '冥想脚本' },
    { key: 'script_podcast', label: '播客脚本' },
    { key: 'voice', label: '人声干声' },
    { key: 'bgm', label: '背景音' },
    { key: 'mix', label: '成品' },
  ];

  const state = { filter: 'all' };

  function artifacts() {
    return state.filter === 'all' ? Store.list() : Store.list(state.filter);
  }

  function render() {
    const list = artifacts();
    root.innerHTML = `
      <div class="flex-between mb-16">
        <div class="tabs" style="margin-bottom:0;border:none">
          ${FILTERS.map(f => `
            <button class="tab ${state.filter === f.key ? 'active' : ''}" data-f="${f.key}">
              ${f.label}<span class="cnt">${f.key === 'all' ? Store.list().length : Store.count(f.key)}</span>
            </button>`).join('')}
        </div>
        ${Store.list().length ? '<button class="btn danger small" id="clear-btn">清空全部</button>' : ''}
      </div>

      ${list.length ? `
        <div class="artifact-grid">
          ${list.map(a => {
            const meta = Store.TYPE_META[a.type];
            return `
              <div class="artifact-card">
                <div class="art-head">
                  <div class="art-name">${Util.escapeHtml(a.name)}</div>
                  <span class="art-time">${Util.fmtDate(a.createdAt)}</span>
                </div>
                <div style="margin:8px 0 4px"><span class="type-badge ${meta.badgeClass}">${meta.label}</span></div>
                <div class="art-summary">${Util.escapeHtml(meta.summary(a))}</div>
                <div class="art-actions">
                  <button class="btn small" data-detail="${a.id}">详情</button>
                  ${meta.next ? `<button class="btn small teal" data-next="${a.id}">${meta.next.label}</button>` : ''}
                  <span style="flex:1"></span>
                  <button class="btn small danger" data-del="${a.id}">删除</button>
                </div>
              </div>`;
          }).join('')}
        </div>` : `
        <div class="card">
          <div class="empty-state">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 7h18v13H3zM3 7l2-3h6l2 3"/></svg>
            <div class="es-title">${state.filter === 'all' ? '产物库为空' : '该分类暂无产物'}</div>
            <div class="es-desc">在各模块页面生成并「存入产物库」后，产物会出现在这里<br>脚本产物可送 TTS 合成，人声 / 背景音可送最终合成</div>
            <a class="btn primary" href="meditation-script.html">去生成冥想脚本</a>
          </div>
        </div>`}
    `;
    bind();
  }

  function bind() {
    root.querySelectorAll('.tab[data-f]').forEach(t => {
      t.addEventListener('click', () => { state.filter = t.dataset.f; render(); });
    });

    document.getElementById('clear-btn')?.addEventListener('click', async () => {
      const ok = await Util.confirmModal('清空产物库', `将删除全部 ${Store.list().length} 个产物，且无法恢复。确定继续吗？`, { danger: true, okText: '清空' });
      if (ok) { Store.clear(); render(); Util.toast('产物库已清空', 'success'); }
    });

    root.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async () => {
        const art = Store.get(b.dataset.del);
        const ok = await Util.confirmModal('删除产物', `确定删除「${art?.name || ''}」吗？`, { danger: true, okText: '删除' });
        if (ok) { Store.remove(b.dataset.del); render(); Util.toast('已删除', 'success'); }
      });
    });

    root.querySelectorAll('[data-detail]').forEach(b => {
      b.addEventListener('click', () => showDetail(b.dataset.detail));
    });

    root.querySelectorAll('[data-next]').forEach(b => {
      b.addEventListener('click', () => {
        const art = Store.get(b.dataset.next);
        if (!art) return;
        const meta = Store.TYPE_META[art.type];
        const target = meta.next.page.replace('.html', '');
        Store.setHandoff({ target, artifactId: art.id });
        location.href = meta.next.page;
      });
    });
  }

  // ---------- 详情弹层 ----------

  function showDetail(id) {
    const a = Store.get(id);
    if (!a) return;
    const meta = Store.TYPE_META[a.type];
    const rows = [
      ['名称', a.name],
      ['类型', meta.label],
      ['创建时间', Util.fmtDate(a.createdAt)],
    ];
    Object.entries(a.params || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') return;
      rows.push([PARAM_LABELS[k] || k, Array.isArray(v) ? v.join(' / ') : v]);
    });

    const contentHtml = a.content?.text
      ? `<hr class="divider"><div class="field-label">内容</div>
         <div class="script-preview-sm" style="max-height:260px">${a.type === 'script_meditation' ? Util.renderScript(a.content.text) : Util.escapeHtml(a.content.text)}</div>`
      : '';

    const mask = Util.el(`
      <div class="modal-mask">
        <div class="modal">
          <div class="modal-head"><h3>产物详情</h3><button class="modal-close" data-act="close">×</button></div>
          <div class="modal-body">
            <div class="mb-16"><span class="type-badge ${meta.badgeClass}">${meta.label}</span></div>
            ${rows.map(([k, v]) => `<div class="detail-row"><span class="dk">${Util.escapeHtml(k)}</span><span class="dv">${Util.escapeHtml(String(v))}</span></div>`).join('')}
            ${contentHtml}
          </div>
          <div class="modal-foot">
            ${meta.next ? `<button class="btn teal" data-act="next">${meta.next.label}</button>` : ''}
            <button class="btn primary" data-act="close">关闭</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(mask);
    mask.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (e.target === mask || act === 'close') mask.remove();
      else if (act === 'next') {
        const target = meta.next.page.replace('.html', '');
        Store.setHandoff({ target, artifactId: a.id });
        location.href = meta.next.page;
      }
    });
  }

  const PARAM_LABELS = {
    topic: '主题', matchedTopic: '匹配主题', duration: '目标时长', mode: '输入方式',
    scene: '场景', engine: '引擎', voiceId: '音色ID', voiceName: '音色', speed: '语速',
    pitch: '音调', scriptId: '来源脚本ID', scriptName: '来源脚本',
    styleId: '风格ID', styleName: '风格', fusionText: '融合指令', structure: '段落结构',
    hasVoice: '含人声', hasBgm: '含背景音', voiceArtId: '人声产物ID', bgmArtId: '背景音产物ID',
    voiceVol: '人声音量', bgmVol: '背景音音量', offset: '背景音偏移', duckMode: '闪避模式',
    format: '导出格式', rules: '合成规则', sourceLength: '原文长度',
  };

  render();
})();
