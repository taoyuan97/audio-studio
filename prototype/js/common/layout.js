/* ============================================================
   公共布局：侧边栏注入 + 通用工具函数
   ============================================================ */

const Layout = (() => {

  // 侧边栏图标（内联 SVG，18x18）
  const I = {
    home: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.2 10 3.5l7 5.7V16a1 1 0 0 1-1 1h-4v-4H8v4H4a1 1 0 0 1-1-1Z"/></svg>',
    meditation: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10" cy="6.5" r="3"/><path d="M4 16.5c1.8-3.2 10.2-3.2 12 0"/><path d="M2.5 12.5c.9-1 1.9-1.8 3-2.3M17.5 12.5c-.9-1-1.9-1.8-3-2.3"/></svg>',
    podcast: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="7.2" y="2.8" width="5.6" height="9.4" rx="2.8"/><path d="M5.2 11a4.8 4.8 0 0 0 9.6 0"/><path d="M10 15.8v2"/></svg>',
    tts: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,10 5,10 7,5 9.5,15 12,6.5 14,13 15.5,10 18,10"/></svg>',
    bgm: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14.5V4.5l8-1.5v10"/><circle cx="5" cy="15" r="2.3"/><circle cx="13" cy="13.5" r="2.3"/></svg>',
    mixdown: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 6h14M3 10h14M3 14h14"/><circle cx="12.5" cy="6" r="1.8" fill="currentColor" stroke="none"/><circle cx="7" cy="10" r="1.8" fill="currentColor" stroke="none"/><circle cx="10.5" cy="14" r="1.8" fill="currentColor" stroke="none"/></svg>',
    library: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h14v3H3z"/><path d="M4.5 7.5V16h11V7.5"/><path d="M8.2 10.8h3.6"/></svg>',
    wave: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,10 5,10 7,5 9.5,15 12,6.5 14,13 15.5,10 18,10"/></svg>',
    play: '<svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M6.5 4.2c0-.8.9-1.3 1.6-.9l8.2 5.1c.7.4.7 1.4 0 1.8l-8.2 5.1c-.7.4-1.6-.1-1.6-.9z"/></svg>',
    pause: '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><rect x="4.5" y="3.5" width="4" height="13" rx="1.2"/><rect x="11.5" y="3.5" width="4" height="13" rx="1.2"/></svg>',
    stop: '<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>',
    check: '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6.5 4.8,9.2 10,3"/></svg>',
    arrow: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12M11 5l5 5-5 5"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5"/><circle cx="10" cy="6.2" r="0.5" fill="currentColor" stroke="none"/></svg>',
    doc: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5h6.5L15 6v11.5H5z"/><path d="M11.5 2.5V6H15"/></svg>',
    settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  };

  const NAV = [
    { key: 'home',       href: 'index.html',           label: '首页概览',   icon: I.home,       group: '总览' },
    { key: 'library',    href: 'library.html',         label: '产物库',     icon: I.library,    group: '总览' },
    { key: 'meditation', href: 'meditation-script.html', label: '冥想剧本生成', icon: I.meditation, group: '剧本生成' },
    { key: 'podcast',    href: 'podcast-script.html',  label: '播客剧本生成', icon: I.podcast,    group: '剧本生成' },
    { key: 'tts',        href: 'tts.html',             label: 'TTS 人声合成', icon: I.tts,        group: '音频生产' },
    { key: 'bgm',        href: 'bgm.html',             label: '背景音生成', icon: I.bgm,        group: '音频生产' },
    { key: 'mixdown',    href: 'mixdown.html',         label: '最终合成',   icon: I.mixdown,    group: '音频生产' },
    { key: 'settings',   href: 'settings.html',        label: '设置',       icon: I.settings,   group: '系统' },
  ];

  function activeKey() {
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const hit = NAV.find(n => n.href.toLowerCase() === page);
    return hit ? hit.key : 'home';
  }

  function init() {
    const root = document.getElementById('sidebar-root');
    if (!root) return;
    const key = activeKey();
    let html = `
      <div class="brand">
        <div class="brand-title">
          <div class="brand-logo">${I.wave}</div>
          AI 音频工作台
        </div>
        <div class="brand-sub">PROTOTYPE · MOCK</div>
      </div>
      <nav class="nav">`;
    let lastGroup = null;
    NAV.forEach(n => {
      if (n.group !== lastGroup) {
        html += `<div class="nav-group-label">${n.group}</div>`;
        lastGroup = n.group;
      }
      html += `<a class="nav-item ${n.key === key ? 'active' : ''}" href="${n.href}" title="${n.label}">${n.icon}<span>${n.label}</span></a>`;
    });
    html += `</nav>
      <div class="sidebar-footer">
        原型演示版 V1.0<br>纯前端 Mock 数据 · Web Audio
      </div>`;
    root.innerHTML = html;
  }

  return { init, NAV, icons: I, activeKey };
})();

/* ============================================================
   通用工具函数
   ============================================================ */

const Util = (() => {

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // mm:ss（超过 1 小时显示 h:mm:ss）
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 从 HTML 字符串创建元素
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ---------- Toast ----------
  function toastWrap() {
    let w = document.querySelector('.toast-wrap');
    if (!w) { w = el('<div class="toast-wrap"></div>'); document.body.appendChild(w); }
    return w;
  }

  function toast(msg, type = 'info') {
    const w = toastWrap();
    const t = el(`<div class="toast ${type}">${escapeHtml(msg)}</div>`);
    w.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, 2400);
    setTimeout(() => t.remove(), 2750);
  }

  // ---------- 确认弹窗 ----------
  function confirmModal(title, msg, { danger = false, okText = '确定' } = {}) {
    return new Promise(resolve => {
      const mask = el(`
        <div class="modal-mask">
          <div class="modal" style="max-width:400px">
            <div class="modal-head"><h3>${escapeHtml(title)}</h3></div>
            <div class="modal-body" style="color:var(--text-2)">${escapeHtml(msg)}</div>
            <div class="modal-foot">
              <button class="btn" data-act="cancel">取消</button>
              <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok" style="${danger ? 'background:var(--red);color:#fff;border-color:var(--red)' : ''}">${escapeHtml(okText)}</button>
            </div>
          </div>
        </div>`);
      document.body.appendChild(mask);
      mask.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (e.target === mask || act === 'cancel') { mask.remove(); resolve(false); }
        else if (act === 'ok') { mask.remove(); resolve(true); }
      });
    });
  }

  // ---------- 脚本标记渲染 ----------
  // 将带 [停顿 3s] [情绪:温柔] [吸气] [语速:慢速] 标记的文本渲染为带徽章的 HTML
  function renderScript(text) {
    let out = '';
    const re = /\[([^\]]+)\]/g;
    let last = 0, m;
    const esc = escapeHtml;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      const tag = m[1].trim();
      let cls = 'b-pause', label = tag;
      if (/^停顿/i.test(tag)) cls = 'b-pause';
      else if (/^情绪/.test(tag)) cls = 'b-emotion';
      else if (tag === '吸气' || tag === '呼气') cls = 'b-breath';
      else if (/^语速/.test(tag)) cls = 'b-speed';
      out += `<span class="badge ${cls}">${esc(tag)}</span>`;
      last = re.lastIndex;
    }
    out += esc(text.slice(last));
    return out;
  }

  function debounce(fn, ms = 200) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  // localStorage 可用性横幅（存储不可用时提示）
  function storageBanner() {
    if (!Store || Store.ok) return;
    const b = el('<div class="storage-banner">当前浏览器环境 localStorage 不可用，页面刷新后数据将丢失（原型降级运行）。</div>');
    document.body.appendChild(b);
  }

  return { uid, escapeHtml, fmtTime, fmtDate, el, toast, confirmModal, renderScript, debounce, storageBanner };
})();
