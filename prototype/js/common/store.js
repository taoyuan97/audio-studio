/* ============================================================
   数据层：产物库 + localStorage 持久化 + 页面交接（handoff）
   ============================================================ */

const Store = (() => {

  const KEY = 'audio_studio_proto_v1';

  // 产物类型元信息（各页共用：产物库、首页、下游选择器）
  const TYPE_META = {
    script_meditation: {
      label: '冥想脚本', badgeClass: 'tb-script-meditation',
      next: { page: 'tts.html', label: '送 TTS 合成' },
      summary: a => {
        const p = a.params || {};
        return `主题「${p.topic || '-'}」 · 目标时长 ${p.duration || '-'} 分钟 · ${a.content?.text ? a.content.text.replace(/\[[^\]]*\]/g, '').replace(/\s/g, '').length : 0} 字`;
      },
    },
    script_podcast: {
      label: '播客脚本', badgeClass: 'tb-script-podcast',
      next: { page: 'tts.html', label: '送 TTS 合成' },
      summary: a => {
        const p = a.params || {};
        const src = p.mode === 'text' ? '文本润色改编' : `话题「${p.topic || '-'}」`;
        return `${src} · ${a.content?.text ? a.content.text.replace(/\s/g, '').length : 0} 字`;
      },
    },
    voice: {
      label: '人声干声', badgeClass: 'tb-voice',
      next: { page: 'mixdown.html', label: '送最终合成' },
      summary: a => {
        const p = a.params || {};
        return `${p.engine === 'ali' ? '阿里云' : '火山引擎'} · ${p.voiceName || '-'} · 语速 ${p.speed}x${p.pitch && p.pitch !== 1 ? ' · 音调 ' + p.pitch + 'x' : ''} · 来源：${p.scriptName || '粘贴文本'}`;
      },
    },
    bgm: {
      label: '背景音', badgeClass: 'tb-bgm',
      next: { page: 'mixdown.html', label: '送最终合成' },
      summary: a => {
        const p = a.params || {};
        const st = (p.structure && p.structure.length) ? ' · 段落 ' + p.structure.join('/') : ' · 均匀结构';
        return `风格「${p.styleName || '-'}」 · ${p.duration} 分钟${p.fusionText ? ' · 融合「' + p.fusionText + '」' : ''}${st}`;
      },
    },
    mix: {
      label: '成品', badgeClass: 'tb-mix',
      next: null,
      summary: a => {
        const p = a.params || {};
        const tracks = [p.hasVoice ? '人声' : null, p.hasBgm ? '背景音' : null].filter(Boolean).join(' + ') || '-';
        return `${tracks} · 格式 ${p.format || '-'}${p.duckMode && p.duckMode !== 'off' ? ' · 闪避模式' + (p.duckMode === 'A' ? 'A（静音段压低）' : 'B（人声时压低）') : ''}`;
      },
    },
  };

  let data = { artifacts: [], handoff: null, settings: null };
  let ok = true;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.artifacts)) {
          data = {
            artifacts: d.artifacts.filter(a => a && a.id && a.type),
            handoff: d.handoff || null,
            settings: d.settings || null,
          };
        }
      }
    } catch (e) { ok = false; /* 脏数据兜底：使用内存初始结构 */ }
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { ok = false; }
  }

  load();

  // ---------- 产物 CRUD ----------

  function list(type) {
    const arr = type ? data.artifacts.filter(a => a.type === type) : data.artifacts.slice();
    return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function get(id) { return data.artifacts.find(a => a.id === id) || null; }

  // 新增或按 id 更新（同 id 覆盖）
  function save(artifact) {
    if (!artifact.id) artifact.id = Util.uid();
    if (!artifact.createdAt) artifact.createdAt = Date.now();
    const i = data.artifacts.findIndex(a => a.id === artifact.id);
    if (i >= 0) data.artifacts[i] = artifact;
    else data.artifacts.unshift(artifact);
    persist();
    return artifact;
  }

  function remove(id) {
    data.artifacts = data.artifacts.filter(a => a.id !== id);
    persist();
  }

  function clear() { data.artifacts = []; persist(); }

  function count(type) { return list(type).length; }

  function recent(n = 5) { return list().slice(0, n); }

  // ---------- 页面交接（handoff） ----------
  // 跨页跳转时写入 { target: 'tts'|'mixdown', artifactId }，目标页读取后自动预选

  function setHandoff(payload) { data.handoff = payload; persist(); }

  function takeHandoff(target) {
    if (data.handoff && data.handoff.target === target) {
      const h = data.handoff;
      data.handoff = null;
      persist();
      return h;
    }
    return null;
  }

  // ---------- 全局设置（大模型统一配置，设置页读写） ----------
  // 结构：{ text|tts|music: { enabled: [modelId…], default: modelId, keys: { modelId: 'sk-…' }, modelIds: { modelId: 'deepseek-chat' } } }

  function defaultSettings() {
    return {
      text:  { enabled: ['deepseek', 'kimi', 'qwen'], default: 'deepseek', keys: {}, modelIds: {} },
      tts:   { enabled: ['ali', 'volc'], default: 'ali', keys: {}, modelIds: {} },
      music: { enabled: ['minimax-music'], default: 'minimax-music', keys: {}, modelIds: {} },
    };
  }

  // 容错归一化：结构非法取默认；enabled 非空化；default 必须在启用列表内
  function normSettings(s) {
    const def = defaultSettings();
    const out = {};
    for (const cat of Object.keys(def)) {
      const c = (s && s[cat]) || {};
      const enabled = Array.isArray(c.enabled) && c.enabled.filter(x => typeof x === 'string').length
        ? c.enabled.filter(x => typeof x === 'string') : def[cat].enabled;
      const dflt = typeof c.default === 'string' && enabled.includes(c.default) ? c.default : enabled[0];
      out[cat] = {
        enabled,
        default: dflt,
        keys: (c.keys && typeof c.keys === 'object') ? c.keys : {},
        modelIds: (c.modelIds && typeof c.modelIds === 'object') ? c.modelIds : {},
      };
    }
    return out;
  }

  function getSettings() { return normSettings(data.settings); }

  // 按类别合并保存（patch 覆盖该类别的 enabled / default / keys）
  function saveSettings(cat, patch) {
    const cur = getSettings();
    if (!cur[cat] || !patch) return cur;
    cur[cat] = { ...cur[cat], ...patch };
    data.settings = cur;
    persist();
    return cur;
  }

  return { TYPE_META, get ok() { return ok; }, list, get, save, remove, clear, count, recent, setHandoff, takeHandoff, getSettings, saveSettings };
})();
