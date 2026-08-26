/* ============================================================
   Web Audio 音频引擎
   - 占位人声合成：解析脚本标记 → 音节级振荡器 + 包络（确定性）
   - 占位音乐合成：风格和弦 + 段落能量包络
   - 播放器：双增益（音量 + 闪避自动化）链
   - 闪避调度：双模式（A 静音段压低 / B 人声时压低）
   - 波形绘制：Canvas 峰值图 + 区段高亮
   ============================================================ */

const AudioEngine = (() => {

  let _ctx = null;

  function ensureCtx() {
    if (!_ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      _ctx = new AC();
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  // ---------- 确定性随机 ----------

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 脚本解析 ----------

  // 情绪标签 → 音高/力度/滤波参数
  const EMOTIONS = {
    温柔: { pitch: 0.95, level: 0.8, cutoff: 1300 },
    舒缓: { pitch: 0.92, level: 0.75, cutoff: 1100 },
    平静: { pitch: 1.0, level: 0.9, cutoff: 1800 },
    明亮: { pitch: 1.08, level: 1.0, cutoff: 2600 },
  };
  const SPEED_MARKS = { 慢速: 0.72, 正常: 1.0, 快速: 1.28 };
  const SYL_BASE = 0.26; // 每音节基准时长（秒）
  const SYL_GAP = 0.07;  // 音节间隙
  const BREATH = { in: 0.9, out: 1.2 };

  // 解析带标记脚本 → 段落数组
  // 段落类型：speech（含 emotion/speed 状态）| pause | breath
  function parseScript(text) {
    const segments = [];
    const re = /\[([^\]]+)\]/g;
    let last = 0, m;
    let emotion = null, speed = null;
    while ((m = re.exec(text))) {
      const before = text.slice(last, m.index).trim();
      if (before) segments.push({ type: 'speech', text: before, emotion, speed });
      const tag = m[1].trim();
      const pause = tag.match(/^停顿\s*(\d+(?:\.\d+)?)\s*s$/i);
      if (pause) segments.push({ type: 'pause', seconds: parseFloat(pause[1]) });
      else if (tag === '吸气') segments.push({ type: 'breath', dir: 'in' });
      else if (tag === '呼气') segments.push({ type: 'breath', dir: 'out' });
      else {
        const em = tag.match(/^情绪[:：]\s*(.+)$/), sp = tag.match(/^语速[:：]\s*(.+)$/);
        if (em) emotion = em[1].trim();
        if (sp) speed = sp[1].trim();
      }
      last = re.lastIndex;
    }
    const tail = text.slice(last).trim();
    if (tail) segments.push({ type: 'speech', text: tail, emotion, speed });
    return segments;
  }

  function countSyllables(text) {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (text.match(/[a-zA-Z]+/g) || []).length;
    const digits = (text.match(/[0-9]+/g) || []).length;
    return cjk + latin + digits;
  }

  // 各段落预估时长（与实际合成使用同一套常数，保证时间轴与音频一致）
  function segmentDurations(segments, speed = 1) {
    return segments.map(seg => {
      if (seg.type === 'pause') return seg.seconds;
      if (seg.type === 'breath') return BREATH[seg.dir];
      const spd = (SPEED_MARKS[seg.speed] || 1) * speed;
      const syls = countSyllables(seg.text);
      return syls * (SYL_BASE + SYL_GAP) / spd;
    });
  }

  function estimateScriptDuration(segments, speed = 1) {
    return segmentDurations(segments, speed).reduce((a, b) => a + b, 0);
  }

  // ---------- 占位人声合成 ----------

  // 事件构建：音节 / 呼吸（时间轴排布）
  function buildVoiceEvents(segments, { voice, speed = 1, pitch = 1 }, rng) {
    const events = [];
    let t = 0.25; // 起始留白
    segments.forEach(seg => {
      if (seg.type === 'pause') { t += seg.seconds; return; }
      if (seg.type === 'breath') {
        const dur = BREATH[seg.dir];
        events.push({ type: 'breath', t, dur, dir: seg.dir });
        t += dur + 0.15;
        return;
      }
      const emo = EMOTIONS[seg.emotion] || EMOTIONS['平静'];
      const spd = (SPEED_MARKS[seg.speed] || 1) * speed;
      const syls = Math.max(1, countSyllables(seg.text));
      const sylDur = SYL_BASE / spd, gap = SYL_GAP / spd;
      for (let i = 0; i < syls; i++) {
        const dur = sylDur * (0.75 + rng() * 0.5);
        const f0 = voice.pitch * pitch * emo.pitch * (0.92 + rng() * 0.16);
        events.push({ type: 'syl', t, dur: Math.min(dur, sylDur * 1.25), f0, emo });
        t += dur + gap;
      }
    });
    return { events, total: t + 0.5 };
  }

  function makeNoiseBuffer(ctx, seed, seconds = 2) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rng = mulberry32(seed);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
    return buf;
  }

  /**
   * 渲染占位人声
   * @param segments parseScript 结果
   * @param voice 音色档案（Mock.VOICES 项）
   */
  async function renderVoice({ segments, voice, speed = 1, pitch = 1, seedKey = 'voice' }) {
    const rng = mulberry32(hashStr(seedKey));
    const { events, total } = buildVoiceEvents(segments, { voice, speed, pitch }, rng);
    const rate = 44100;
    const len = Math.max(rate, Math.ceil(total * rate));
    const oc = new OfflineAudioContext(1, len, rate);

    const master = oc.createGain(); master.gain.value = 0.9;
    const comp = oc.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6;
    master.connect(comp); comp.connect(oc.destination);

    const noiseBuf = makeNoiseBuffer(oc, hashStr(seedKey + ':noise'));
    let nyquist = rate / 2 - 200;

    events.forEach(ev => {
      if (ev.type === 'breath') {
        // 呼吸声：带通噪声 + 起/落包络
        const src = oc.createBufferSource(); src.buffer = noiseBuf;
        src.loop = true;
        const bp = oc.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 620; bp.Q.value = 0.8;
        const g = oc.createGain();
        const peak = 0.06;
        g.gain.setValueAtTime(0.0001, ev.t);
        if (ev.dir === 'in') {
          g.gain.linearRampToValueAtTime(peak, ev.t + ev.dur * 0.55);
          g.gain.linearRampToValueAtTime(0.0001, ev.t + ev.dur);
        } else {
          g.gain.linearRampToValueAtTime(peak, ev.t + ev.dur * 0.2);
          g.gain.linearRampToValueAtTime(0.0001, ev.t + ev.dur);
        }
        src.connect(bp); bp.connect(g); g.connect(master);
        src.start(ev.t); src.stop(ev.t + ev.dur + 0.05);
        return;
      }
      // 音节：振荡器 + 音节包络 + 低通（由情绪决定明暗）
      const o = oc.createOscillator();
      o.type = voice.wave;
      o.frequency.value = ev.f0;
      const g = oc.createGain();
      const peak = 0.5 * ev.emo.level * (voice.level || 1);
      const a = Math.min(0.025, ev.dur * 0.3);
      const hold = Math.max(a, ev.dur * 0.45);
      g.gain.setValueAtTime(0.0001, ev.t);
      g.gain.linearRampToValueAtTime(peak, ev.t + a);
      g.gain.setValueAtTime(peak, ev.t + hold);
      g.gain.linearRampToValueAtTime(0.0001, ev.t + ev.dur);
      const f = oc.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.min(nyquist, (voice.brightness || 1) * ev.emo.cutoff);
      f.Q.value = 0.7;
      o.connect(g); g.connect(f); f.connect(master);
      // 长音节加轻微颤音
      if (ev.dur > 0.18) {
        const lfo = oc.createOscillator(); lfo.frequency.value = 5 + rng() * 2;
        const lg = oc.createGain(); lg.gain.value = ev.f0 * 0.018;
        lfo.connect(lg); lg.connect(o.frequency);
        lfo.start(ev.t); lfo.stop(ev.t + ev.dur + 0.05);
      }
      o.start(ev.t); o.stop(ev.t + ev.dur + 0.02);
    });

    return await oc.startRendering();
  }

  // ---------- 占位音乐合成 ----------

  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  const SECTION_DEFS = [
    { id: 'intro', name: 'Intro', prop: 0.15, e0: 0.35, e1: 0.55 },
    { id: 'buildup', name: 'Build Up', prop: 0.20, e0: 0.55, e1: 0.90 },
    { id: 'drop', name: 'Drop', prop: 0.35, e0: 1.00, e1: 0.95 },
    { id: 'outro', name: 'Outro', prop: 0.30, e0: 0.60, e1: 0.25 },
  ];

  // 段落结构 → 区段列表（未勾选任何段落时为均匀 Loop）
  function buildSections(structureIds, duration) {
    const picked = SECTION_DEFS.filter(s => (structureIds || []).includes(s.id));
    if (!picked.length) return [{ name: 'Loop', start: 0, end: duration, e0: 0.7, e1: 0.78 }];
    const sum = picked.reduce((a, s) => a + s.prop, 0);
    let t = 0;
    return picked.map((s, i) => {
      const d = (s.prop / sum) * duration;
      const sec = { name: s.name, start: t, end: t + d, e0: s.e0, e1: s.e1 };
      t += d;
      if (i === picked.length - 1) sec.end = duration;
      return sec;
    });
  }

  function energyAt(sections, t) {
    const dur = sections[sections.length - 1].end || 1;
    const tt = Math.min(Math.max(t, 0), dur);
    let sec = sections[0];
    for (const s of sections) { if (tt >= s.start) sec = s; else break; }
    const p = sec.end > sec.start ? (tt - sec.start) / (sec.end - sec.start) : 0;
    return sec.e0 + (sec.e1 - sec.e0) * p;
  }

  // 和弦铺底（Pad）
  function padChord(oc, dest, freqs, t, dur, { type = 'sawtooth', level = 0.15, attack = 0.8, release = 1.5, filter = 900, detune = 6 }) {
    const flt = oc.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = filter; flt.Q.value = 0.5;
    flt.connect(dest);
    freqs.forEach(fq => {
      [-detune, detune].forEach(d => {
        const o = oc.createOscillator();
        o.type = type; o.frequency.value = fq; o.detune.value = d;
        const g = oc.createGain();
        const lv = level / freqs.length;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(lv, t + attack);
        g.gain.setValueAtTime(lv, t + Math.max(attack, dur - release));
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(flt);
        o.start(t); o.stop(t + dur + 0.05);
      });
    });
  }

  // 拨弦音（古琴/钢琴/吉他质感）
  function pluckNote(oc, dest, freq, t, { type = 'triangle', level = 0.22, decay = 1.2, filter = null }) {
    const o = oc.createOscillator(); o.type = type; o.frequency.value = freq;
    const o2 = oc.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const g = oc.createGain(), g2 = oc.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(level * 0.25, t + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.5);
    let outNode = dest;
    if (filter) {
      const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter;
      f.connect(dest); outNode = f;
    }
    o.connect(g); g.connect(outNode);
    o2.connect(g2); g2.connect(outNode);
    o.start(t); o.stop(t + decay + 0.05);
    o2.start(t); o2.stop(t + decay * 0.5 + 0.05);
  }

  // 笛箫旋律线（融合指令）
  function fluteNote(oc, dest, freq, t, dur, level = 0.13) {
    const o = oc.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const lfo = oc.createOscillator(); lfo.frequency.value = 5.2;
    const lg = oc.createGain(); lg.gain.value = freq * 0.012;
    lfo.connect(lg); lg.connect(o.frequency);
    const g = oc.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.18);
    g.gain.setValueAtTime(level, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  }

  function noiseTexture(oc, dest, t, dur, { level = 0.045, cutoff = 700, seed = 4321 }) {
    const buf = makeNoiseBuffer(oc, seed, Math.min(dur, 4));
    const src = oc.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.4;
    const g = oc.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + Math.min(2, dur * 0.2));
    g.gain.setValueAtTime(level, t + dur - Math.min(2, dur * 0.2));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t); src.stop(t + dur + 0.05);
  }

  /**
   * 渲染占位音乐
   * @returns { buffer, sections }
   */
  async function renderMusic({ style, fusion = {}, duration, structure = [], seedKey = 'bgm' }) {
    const dur = Math.max(5, Math.min(duration, 600));
    const rate = 44100;
    const oc = new OfflineAudioContext(1, Math.ceil(dur * rate), rate);
    const rng = mulberry32(hashStr(seedKey));

    const master = oc.createGain(); master.gain.value = 0.85;
    const comp = oc.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 5;
    master.connect(comp); comp.connect(oc.destination);

    const sections = buildSections(structure, dur);

    // 主循环：按和弦推进
    const chordDur = style.tempo;
    let idx = 0;
    for (let t = 0; t < dur; t += chordDur, idx++) {
      const chord = style.chords[idx % style.chords.length];
      const freqs = chord.map(midiToFreq);
      const e = energyAt(sections, t + chordDur / 2);
      const remain = Math.min(chordDur + 1.6, dur - t + 1.2);

      if (style.instr === 'pad') {
        padChord(oc, master, freqs, t, remain, {
          type: style.wave,
          level: style.level * (0.35 + 0.65 * e),
          attack: Math.min(1.2, chordDur * 0.4),
          release: Math.min(2, chordDur * 0.8),
          filter: style.filter * (0.5 + e),
        });
      }

      if (style.instr === 'pluck') {
        const n = style.notesPerChord || 4;
        for (let i = 0; i < n; i++) {
          const frac = style.id === 'gufeng'
            ? (i + 0.3 + rng() * 0.5) / n           // 古风：留白式松散拨弦
            : (i + 0.5) / n;                        // 钢琴/民谣：均匀分解
          const nt = t + frac * chordDur;
          if (nt >= dur) break;
          const tone = freqs[i % freqs.length] * (rng() > 0.85 ? 2 : 1);
          pluckNote(oc, master, tone, nt, {
            type: style.wave,
            level: style.level * (0.35 + 0.65 * e) * (0.7 + rng() * 0.3),
            decay: style.decay,
            filter: style.filter,
          });
        }
      }

      // 电子琶音（风格自带 或 融合指令开启）
      if ((style.arp || fusion.arp) && style.instr === 'pad') {
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          const nt = t + (i / steps) * chordDur;
          if (nt >= dur) break;
          if (rng() > 0.15 + e * 0.6) continue; // 能量越高琶音越密
          const tone = freqs[i % freqs.length] * (i >= 4 ? 2 : 1);
          pluckNote(oc, master, tone, nt, { type: 'triangle', level: 0.16 * e + 0.05, decay: 0.45 });
        }
      }

      // 融合指令：笛箫旋律线
      if (fusion.lead === 'flute' && idx % 2 === 0) {
        const tone = freqs[(idx / 2) % freqs.length | 0] * 2;
        fluteNote(oc, master, tone, t + 0.3, Math.min(chordDur * 1.2, dur - t - 0.3));
      }
    }

    // 风格自带环境底噪 或 融合指令开启
    if (style.noise || fusion.noise) {
      noiseTexture(oc, master, 0, dur, {
        level: style.noise ? 0.05 : 0.035,
        cutoff: style.noise ? style.filter : 900,
        seed: hashStr(seedKey + ':n'),
      });
    }

    // 融合指令：额外琶音律动（拨弦类风格）
    if (fusion.arp && style.instr === 'pluck') {
      const step = 0.32;
      for (let t = 0; t < dur; t += step) {
        if (rng() > 0.55) continue;
        const e = energyAt(sections, t);
        const chord = style.chords[Math.floor(t / chordDur) % style.chords.length];
        const tone = midiToFreq(chord[Math.floor(rng() * chord.length)]) * 2;
        pluckNote(oc, master, tone, t, { type: 'sine', level: 0.1 * e + 0.03, decay: 0.4 });
      }
    }

    const buffer = await oc.startRendering();
    return { buffer, sections };
  }

  // ---------- 人声活动检测（供闪避使用） ----------

  /**
   * 检测静音段（≥ minSec）与人声段（补集）
   * @returns { silences: [{start,end}], voiceSegs: [{start,end}] }
   */
  function detectVoiceActivity(buffer, { minSec = 1.0, threshold = 0.01 } = {}) {
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    const win = Math.max(1, Math.floor(rate * 0.05)); // 50ms 窗口
    const nWin = Math.floor(data.length / win);
    const active = new Uint8Array(nWin);
    for (let w = 0; w < nWin; w++) {
      let sum = 0;
      const s = w * win, e = s + win;
      for (let i = s; i < e; i++) sum += data[i] * data[i];
      active[w] = Math.sqrt(sum / win) > threshold ? 1 : 0;
    }
    // 静音连续段
    const silences = [];
    let runStart = -1;
    for (let w = 0; w <= nWin; w++) {
      const a = w < nWin ? active[w] : 1;
      if (!a && runStart < 0) runStart = w;
      else if (a && runStart >= 0) {
        const start = runStart * 0.05, end = w * 0.05;
        if (end - start >= minSec) silences.push({ start, end });
        runStart = -1;
      }
    }
    // 人声段 = 补集（合并细碎间隙）
    const duration = buffer.duration;
    const voiceSegs = [];
    let t = 0;
    for (const r of silences) {
      if (r.start > t + 0.05) voiceSegs.push({ start: t, end: r.start });
      t = r.end;
    }
    if (duration > t + 0.05) voiceSegs.push({ start: t, end: duration });
    return { silences, voiceSegs: voiceSegs.filter(s => s.end - s.start >= 0.4) };
  }

  // ---------- 播放器（音量增益 → 闪避增益 双链） ----------

  class BufferPlayer {
    constructor() {
      this.buffer = null;
      this.source = null;
      this.volGain = null;
      this.duckGain = null;
      this.volume = 1;
      this.loop = false;
      this.playing = false;
      this._pos = 0;
      this._startCtxTime = 0;
      this.onEnded = null;
    }

    _ensure() {
      const ctx = ensureCtx();
      if (!this.volGain) {
        this.volGain = ctx.createGain();
        this.duckGain = ctx.createGain();
        this.volGain.connect(this.duckGain);
        this.duckGain.connect(ctx.destination);
        this.volGain.gain.value = this.volume;
      }
      return ctx;
    }

    setBuffer(buf) { this.stop(); this.buffer = buf; }

    get duration() { return this.buffer ? this.buffer.duration : 0; }

    get position() {
      if (!this.playing || !this.buffer) return this._pos;
      const ctx = this._ensure();
      const p = this._pos + Math.max(0, ctx.currentTime - this._startCtxTime);
      return this.loop ? p : Math.min(p, this.duration);
    }

    play(fromSec = null, delaySec = 0) {
      if (!this.buffer) return;
      this.pause();
      const ctx = this._ensure();
      if (ctx.state === 'suspended') ctx.resume();
      const start = fromSec != null
        ? Math.max(0, Math.min(fromSec, this.duration))
        : Math.min(this._pos, this.duration);
      this._pos = start;
      this._startCtxTime = ctx.currentTime + delaySec;
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = this.loop;
      src.connect(this.volGain);
      src.start(this._startCtxTime, start);
      const self = this;
      src.onended = () => {
        if (self.source !== src) return;
        self.source = null;
        self.playing = false;
        if (!self.loop) self._pos = self.duration;
        if (self.onEnded) self.onEnded();
      };
      this.source = src;
      this.playing = true;
    }

    pause() {
      if (!this.source) return;
      const p = this.position;
      const src = this.source;
      this.source = null;
      this.playing = false;
      try { src.stop(); } catch (e) { /* 尚未启动的 source 直接取消 */ }
      this._pos = Math.min(Math.max(0, p), this.duration || p);
    }

    stop() { this.pause(); this._pos = 0; }

    setVolume(v) {
      this.volume = v;
      if (this.volGain) this.volGain.gain.value = v;
    }

    // 闪避自动化使用的 AudioParam
    duckParam() { this._ensure(); return this.duckGain.gain; }
  }

  // ---------- 闪避调度 ----------
  // mode: 'A' 静音段压低（PRD 字面）| 'B' 人声时压低（常规闪避）| 'off'
  function scheduleDuck(param, { mode, segments, fromPosition, base = 1, duckLevel = 0.22 }) {
    const ctx = ensureCtx();
    const now = ctx.currentTime;
    param.cancelScheduledValues(0);
    if (mode === 'off' || !segments || !segments.length) {
      param.setValueAtTime(base, now);
      return;
    }
    const pos = fromPosition || 0;
    const active = segments.filter(s => s.end > pos).sort((a, b) => a.start - b.start);
    const insideNow = segments.some(s => s.start <= pos && s.end > pos);
    param.setValueAtTime(insideNow ? duckLevel : base, now);
    let cursor = now;
    for (const seg of active) {
      const t1 = now + Math.max(0.05, seg.end - pos);
      let t0 = now + Math.max(0, seg.start - pos);
      if (t1 - Math.max(t0, now) < 0.4) continue; // 剩余过短，跳过
      const skipDown = seg.start <= pos;
      if (!skipDown) {
        if (t0 < cursor + 0.02) t0 = cursor + 0.02;
        param.setValueAtTime(base, t0);
        param.linearRampToValueAtTime(duckLevel, t0 + 0.2);
      }
      const backT = Math.min(Math.max(t1 - 0.15, (skipDown ? now : t0) + 0.26), t1 - 0.05);
      param.setValueAtTime(duckLevel, backT);
      param.linearRampToValueAtTime(base, t1);
      cursor = Math.max(cursor, t1);
    }
  }

  // ---------- 背景音有效轨（偏移 + 循环填充/截断） ----------

  function buildEffectiveBgm(buf, offsetSec, timelineDur) {
    if (!buf) return null;
    const rate = buf.sampleRate;
    const len = Math.max(1, Math.floor(timelineDur * rate));
    let out;
    try {
      out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: rate });
    } catch (e) {
      out = ensureCtx().createBuffer(1, len, rate);
    }
    const src = buf.getChannelData(0), dst = out.getChannelData(0);
    const bgmLen = src.length;
    const off = Math.max(0, Math.floor(offsetSec * rate));
    for (let i = 0; i < len; i++) {
      const p = i - off;
      dst[i] = p < 0 ? 0 : src[p % bgmLen];
    }
    return out;
  }

  // ---------- 波形绘制 ----------

  /**
   * 绘制音频缓冲峰值图
   * opts: { progressSec, color, playedColor, regions: [{start,end,color,label}] }
   */
  function drawBuffer(canvas, buffer, opts = {}) {
    if (!canvas || !buffer) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(60, Math.floor(canvas.clientWidth || 600));
    const h = Math.max(20, Math.floor(canvas.clientHeight || 84));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    const data = buffer.getChannelData(0);
    const mid = h / 2, amp = mid - 4;
    const color = opts.color || '#3a4258';
    const playedColor = opts.playedColor || '#6f8cff';
    const progressSec = opts.progressSec;
    const progressX = progressSec != null && buffer.duration > 0
      ? Math.floor((progressSec / buffer.duration) * w) : -1;

    const stride = Math.max(1, Math.floor(data.length / w / 40));
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * data.length);
      const i1 = Math.min(data.length, Math.floor(((x + 1) / w) * data.length));
      let mn = 1, mx = -1;
      for (let i = i0; i < i1; i += stride) {
        const v = data[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mn > mx) { mn = 0; mx = 0; }
      c.fillStyle = x <= progressX ? playedColor : color;
      const top = mid - mx * amp, bot = mid - mn * amp;
      c.fillRect(x, top, 1, Math.max(1.2, bot - top));
    }

    // 区段覆盖（静音段 / 闪避高亮 / 段落结构）
    (opts.regions || []).forEach(r => {
      const x0 = (r.start / buffer.duration) * w;
      const x1 = (r.end / buffer.duration) * w;
      if (x1 <= 0 || x0 >= w) return;
      const cx0 = Math.max(0, x0), cx1 = Math.min(w, x1);
      if (r.color) {
        c.fillStyle = r.color;
        c.fillRect(cx0, 0, Math.max(1, cx1 - cx0), h);
      }
      if (r.label && cx1 - cx0 > 26) {
        c.fillStyle = r.labelColor || '#e6b25a';
        c.font = '10px sans-serif';
        c.fillText(r.label, cx0 + 4, 12);
      }
    });

    // 播放头
    if (progressX >= 0 && progressX <= w) {
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillRect(progressX, 0, 1.5, h);
    }
  }

  return {
    ensureCtx,
    parseScript,
    segmentDurations,
    estimateScriptDuration,
    countSyllables,
    renderVoice,
    renderMusic,
    detectVoiceActivity,
    BufferPlayer,
    scheduleDuck,
    buildEffectiveBgm,
    drawBuffer,
    EMOTIONS,
  };
})();
