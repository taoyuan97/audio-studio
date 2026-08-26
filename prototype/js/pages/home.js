/* ============================================================
   首页概览：模块导航 + 产物统计 + 最近产物
   ============================================================ */

Layout.init();
Util.storageBanner();

(function () {

  const root = document.getElementById('page-root');

  const MODULES = [
    { href: 'meditation-script.html', icon: Layout.icons.meditation, color: 'var(--teal)', name: '冥想剧本生成', desc: '主题 + 时长 → 带标记的结构化引导脚本' },
    { href: 'podcast-script.html', icon: Layout.icons.podcast, color: 'var(--blue)', name: '播客剧本生成', desc: '话题生成 / 文本润色 → 单人讲述脚本' },
    { href: 'tts.html', icon: Layout.icons.tts, color: 'var(--purple)', name: 'TTS 人声合成', desc: '阿里云 / 火山引擎 · 场景预设 · 音色语速调节' },
    { href: 'bgm.html', icon: Layout.icons.bgm, color: 'var(--amber)', name: '背景音生成', desc: '风格化纯音乐 · 跨风格融合 · 段落结构' },
    { href: 'mixdown.html', icon: Layout.icons.mixdown, color: 'var(--red)', name: '最终合成', desc: '人声 + 背景音叠加 · 双模式闪避 · 导出' },
    { href: 'library.html', icon: Layout.icons.library, color: 'var(--accent)', name: '产物库', desc: '统一管理各模块产物，支撑灵活组合' },
  ];

  const STATS = [
    { type: 'script_meditation', label: '冥想脚本', color: 'var(--teal)' },
    { type: 'script_podcast', label: '播客脚本', color: 'var(--blue)' },
    { type: 'voice', label: '人声干声', color: 'var(--purple)' },
    { type: 'bgm', label: '背景音', color: 'var(--amber)' },
    { type: 'mix', label: '成品', color: 'var(--red)' },
  ];

  function render() {
    const recents = Store.recent(5);
    root.innerHTML = `
      <div class="hero">
        <h1>AI 多场景音频工作台</h1>
        <p>覆盖冥想引导、单人播客、纯音乐三大场景。剧本生成、TTS 合成、背景音生成、最终合成四个模块相互解耦，可单独使用，也可灵活组合导出成品。</p>
        <div class="hero-tags">
          <span class="hero-tag">TTS：阿里云 / 火山引擎</span>
          <span class="hero-tag">剧本：DeepSeek / 通义千问（示意）</span>
          <span class="hero-tag" style="color:var(--amber);border-color:rgba(230,178,90,.35)">纯前端原型 · 全部数据为 Mock</span>
        </div>
      </div>

      <div class="module-grid mb-16">
        ${MODULES.map(m => `
          <a class="module-card" href="${m.href}">
            <span class="module-arrow">${Layout.icons.arrow}</span>
            <div class="module-icon" style="background:color-mix(in srgb, ${m.color} 14%, transparent);color:${m.color}">${m.icon}</div>
            <h3>${m.name}</h3>
            <p>${m.desc}</p>
          </a>`).join('')}
      </div>

      <div class="card">
        <div class="flex-between mb-16">
          <div class="card-title mb-0">产物统计</div>
          <a class="text-sm" href="library.html">进入产物库 ${Layout.icons.arrow}</a>
        </div>
        <div class="stat-row">
          ${STATS.map(s => `
            <div class="stat-item">
              <div class="stat-num" style="color:${s.color}">${Store.count(s.type)}</div>
              <div class="stat-label">${s.label}</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title mb-16">最近产物</div>
        ${recents.length ? recents.map(a => {
          const meta = Store.TYPE_META[a.type];
          return `
            <div class="recent-item">
              <span class="type-badge ${meta.badgeClass}">${meta.label}</span>
              <span class="ri-name">${Util.escapeHtml(a.name)}</span>
              <span class="ri-time">${Util.fmtDate(a.createdAt)}</span>
            </div>`;
        }).join('') : `
          <div class="empty-state" style="padding:30px 20px">
            <div class="es-title">暂无产物</div>
            <div class="es-desc">推荐路径：冥想剧本生成 → TTS 人声合成 → 最终合成导出</div>
          </div>`}
      </div>

      <div class="card">
        <div class="card-title">快速开始</div>
        <div class="card-desc">各模块独立运行，中间产物自动汇入产物库，供下游模块选择组合。</div>
        <div class="param-chips" style="gap:10px">
          <span class="param-chip">1. 生成剧本（冥想 / 播客）</span>
          <span class="param-chip">2. TTS 合成人声干声</span>
          <span class="param-chip">3. 生成背景音（可选）</span>
          <span class="param-chip">4. 最终合成导出 MP3 / WAV</span>
        </div>
        <div class="note">
          ${Layout.icons.info}
          <span>纯音乐场景：直接使用「背景音生成」模块并在最终合成中仅选择背景音轨导出。</span>
        </div>
      </div>`;
  }

  render();
})();
