/* ============================================================
   Mock 数据与模拟生成函数
   说明：所有「AI 生成」均为本地预置数据 + 确定性变换，不调用任何外部 API
   ============================================================ */

const Mock = (() => {

  // ---------- 冥想场景 ----------

  const MEDITATION_TOPICS = ['深海放松', '焦虑缓解', '清晨唤醒', '身体扫描', '睡眠引导', '专注呼吸'];

  // 每个预设主题对应一套脚本模板；自由输入的主题会替换进默认模板
  // 停顿时长会按目标时长档位缩放（5 分钟原样 / 15 分钟 ×1.6 / 30 分钟 ×2.4）
  const MEDITATION_SCRIPTS = {
    '深海放松': `欢迎来到今天的深海放松练习。[情绪:温柔]
[停顿 3s]
请找一个安静舒适的位置，轻轻闭上眼睛。[语速:慢速]
[停顿 4s]
[吸气] 慢慢地，让清新的空气流入身体。
[停顿 2s]
[呼气] 把肩上的重量，一点一点交给呼吸。[情绪:舒缓]
[停顿 5s]
想象你正缓缓沉入一片温暖的海水，阳光从头顶洒下细碎的光斑。
[停顿 6s]
每呼吸一次，你就更放松一分，海水温柔地托着你。[语速:慢速][情绪:温柔]
[停顿 8s]
[吸气] 感受腹部像海浪一样轻轻起伏。
[停顿 3s]
[呼气] 所有的念头，都随着气泡浮向远处。
[停顿 8s]
现在，只是安静地待在这里，享受这份深海的宁静。
[停顿 10s]
[情绪:温柔] 当你准备好了，轻轻动一动手指。
[停顿 3s]
慢慢地睁开眼睛，把这份平静带回你的日常。`,

    '焦虑缓解': `欢迎来到今天的焦虑缓解练习。[情绪:温柔]
[停顿 3s]
找一个让你感到安全的姿势，把双手自然地放在腿上。[语速:慢速]
[停顿 4s]
如果此刻你感到紧张，没有关系，这很正常。[情绪:平静]
[停顿 3s]
[吸气] 用四拍的时间，缓缓吸入空气。
[停顿 2s]
[呼气] 再用六拍的时间，把它缓缓吐出去。[情绪:舒缓]
[停顿 5s]
想象那些让你焦虑的事情，变成天上的云。
[停顿 4s]
云会来，也会走，而你始终是那片安静的天空。[语速:慢速]
[停顿 8s]
[吸气] 继续跟随呼吸的节奏。
[停顿 2s]
[呼气] 让肩膀沉下来，让眉头松开。
[停顿 8s]
你不需要立刻解决所有问题，此刻只需要照顾好自己。[情绪:温柔]
[停顿 10s]
[呼气] 再做最后一次深呼吸。
[停顿 4s]
当你准备好了，慢慢睁开眼睛，带着这份松弛回到此刻。`,

    '清晨唤醒': `早上好，欢迎来到今天的清晨唤醒练习。[情绪:明亮]
[停顿 2s]
请坐起来，让脊柱自然挺直，肩膀放松。[语速:正常]
[停顿 3s]
[吸气] 感受清晨的空气，清新而充满能量。
[停顿 2s]
[呼气] 把残留的睡意，轻轻呼出体外。
[停顿 4s]
想象阳光正落在你的头顶，温暖一点点蔓延到全身。[情绪:温柔]
[停顿 5s]
[吸气] 新的一天，带来新的可能性。
[停顿 2s]
[呼气] 昨天的疲惫，已经完成了它的使命。[情绪:舒缓]
[停顿 6s]
轻轻转动一下脖子和肩膀，唤醒身体的每一个部分。[语速:正常]
[停顿 6s]
[吸气] 带着清晰与平静。
[停顿 2s]
[呼气] 准备好，迎接今天的第一件事。
[停顿 5s]
[情绪:明亮] 慢慢睁开眼睛，今天会是美好的一天。`,

    '身体扫描': `欢迎来到今天的身体扫描练习。[情绪:温柔]
[停顿 3s]
请平躺下来，双臂自然放在身体两侧。[语速:慢速]
[停顿 4s]
[吸气] 做一次深呼吸。
[停顿 2s]
[呼气] 让身体沉向地面。[情绪:舒缓]
[停顿 5s]
把注意力放到脚趾，感受它们的温度。
[停顿 6s]
注意力慢慢上移，经过脚踝、小腿。
[停顿 6s]
感受膝盖的松弛，大腿的重量。[语速:慢速]
[停顿 8s]
[吸气] 让呼吸轻轻按摩你的腹部。
[停顿 2s]
[呼气] 继续向上，经过胸口、肩膀。
[停顿 8s]
感受脖颈、下颌、眉心，一一松开。[情绪:温柔]
[停顿 10s]
整个身体，现在都得到了照拂。
[停顿 5s]
当你准备好了，慢慢回到当下，动动手指和脚趾。`,

    '睡眠引导': `晚上好，欢迎来到今晚的睡眠引导。[情绪:温柔]
[停顿 4s]
把灯光调暗，让身体以最舒服的姿势陷进被子里。[语速:慢速]
[停顿 6s]
[吸气] 缓缓地，不需要用力。
[停顿 3s]
[呼气] 白天的一切，都可以暂时放下了。[情绪:舒缓]
[停顿 8s]
想象你走下一段安静的台阶，每下一级，都更困一分。
[停顿 6s]
一级，两级，三级……身体越来越沉。[语速:慢速]
[停顿 10s]
[吸气] 呼吸变得又慢又轻。
[停顿 3s]
[呼气] 思绪像水面，渐渐平静。[情绪:温柔]
[停顿 12s]
没有需要完成的事，没有需要解决的问题。
[停顿 10s]
安心地睡吧，晚安。`,

    '专注呼吸': `欢迎来到今天的专注呼吸练习。[情绪:平静]
[停顿 3s]
采取一个稳定的坐姿，轻轻合上双眼。[语速:慢速]
[停顿 4s]
[吸气] 数一，缓慢地吸入。
[停顿 2s]
[呼气] 数二，缓慢地呼出。[情绪:舒缓]
[停顿 4s]
[吸气] 数三。
[停顿 2s]
[呼气] 数四。
[停顿 6s]
如果思绪飘走了，温柔地带回到呼吸上，不必责备自己。[情绪:温柔][语速:慢速]
[停顿 8s]
[吸气] 感受气息经过鼻腔的温度。
[停顿 2s]
[呼气] 感受身体一点点安定下来。
[停顿 10s]
继续跟随自己的节奏，呼吸，数息。
[停顿 8s]
[情绪:平静] 带着这份专注，慢慢睁开眼睛。`,
  };

  // 时长档位 → 停顿缩放系数（示意：目标时长越长，静默间隙越长）
  const DURATION_SCALE = { 5: 1, 15: 1.6, 30: 2.4 };

  function scalePauses(text, factor) {
    if (factor === 1) return text;
    return text.replace(/\[停顿\s*(\d+(?:\.\d+)?)s\]/g, (_, n) => `[停顿 ${Math.round(parseFloat(n) * factor)}s]`);
  }

  // 匹配主题：命中预设关键词则用对应脚本，否则用默认模板并替换主题词
  function matchTopic(input) {
    const t = (input || '').trim();
    const hit = MEDITATION_TOPICS.find(k => t.includes(k) || k.includes(t));
    if (hit && MEDITATION_SCRIPTS[hit]) return { scriptKey: hit, topic: hit };
    return { scriptKey: '深海放松', topic: t || '放松' };
  }

  function generateMeditation({ topic, duration }) {
    const { scriptKey, topic: realTopic } = matchTopic(topic);
    const factor = DURATION_SCALE[duration] || 1;
    let text = MEDITATION_SCRIPTS[scriptKey];
    // 将脚本首句的主题词替换为用户输入的主题
    text = text.replace(/(欢迎来到今天的)([^练]{2,10})(练习)/, `$1${realTopic}$3`);
    text = scalePauses(text, factor);
    return { text, matchedTopic: realTopic };
  }

  // ---------- 播客场景 ----------

  const PODCAST_TOPIC_SCRIPT = `大家好，欢迎收听今天的节目。
今天我们想聊一个很多人都在经历的话题：AI 时代的学习方法。
先说一个观察：过去我们习惯的学习路径是线性的——找一本教材，从第一章读到最后一章，追求"把基础打牢"。这套方法在知识更新缓慢的年代非常有效。
但 AI 出现之后，情况变了。知识的生产速度远超个人的消化速度，"学完"不再是一个可以实现的目标。
那怎么办？我自己的答案是三个转变。
第一个转变，是从"系统学习"转向"按需学习"。先有问题，再去学习，让问题牵引知识的获取。AI 恰好是这种学习方式的最佳搭档，你随时可以问，随时得到解释。
第二个转变，是从"记忆知识"转向"构建框架"。具体的细节可以交给工具去查，真正需要内化的，是领域的基本框架和判断力。框架在你的脑子里，细节在工具里。
第三个转变，是从"单打独斗"转向"人机协作"。把 AI 当成一个不知疲倦的陪练：让它提问、让它反驳、让它帮你找盲区。你负责方向和品味，它负责广度和速度。
当然，这并不是说基础不重要。恰恰相反，越是依赖工具，你越需要有能力判断工具给出的东西对不对。这个判断力，依然来自扎实的基本功。
所以我的结论是：AI 时代的学习，不是学得更少，而是学得更准。把有限的精力，花在机器替代不了的地方。
以上就是今天的分享。如果对你有启发，欢迎订阅收听，我们下期再见。`;

  const PODCAST_TOPIC_HINT = '已围绕话题生成单人讲述脚本：开场引入 → 主体内容（三个论点）→ 总结收尾';

  // 文本润色改编：从用户粘贴文本中抽取要点，套入口语化讲述结构
  // duration 档位响应：15 分钟追加展开段，30 分钟再追加延伸段
  const PODCAST_TEXT_EXPAND_15 = '顺着这几个要点再多说一句：同样的内容，被"讲出来"和被"读出来"，效果差别很大。口播的过程会强迫你补全逻辑链条里的每一处跳跃，这本身就是一次深度加工。';
  const PODCAST_TEXT_EXTEND_30 = '如果想让改编效果更好，可以试着给每个要点补一个自己的例子或反例。抽象的要点负责骨架，具体的例子负责血肉，两者搭在一起，听众才更容易跟着走。';

  // 剥离对话式输入的指令前缀（如「帮我把这段笔记润色成播客脚本：……」→ 仅保留正文）
  function stripInstruction(raw) {
    const t = (raw || '').trim();
    const m = t.match(/^[^。！？!?\n]{0,30}[：:](?=\s*\S)/);
    if (m && /(润色|改编|改写|整理|播客|脚本|口播)/.test(m[0])) return t.slice(m[0].length).trim();
    return t;
  }

  function generatePodcastFromText(raw, duration = 5) {
    const src = stripInstruction(raw);
    // 抽取前几个句子作为主体素材
    const sentences = src.split(/[。！？!?\n]+/).map(s => s.trim()).filter(s => s.length > 4);
    const picked = sentences.slice(0, 4);
    const body = picked.map((s, i) => `${i + 1}. ${s}。`).join('\n');
    const topicGuess = picked[0] ? picked[0].slice(0, 12) : '你分享的内容';
    let text = `大家好，欢迎收听今天的节目。
今天想和你聊聊的，是从一段笔记整理出来的话题：${topicGuess}。
我先把你原来的内容，梳理成了几个要点：
${body}
把这些要点串起来看，其实核心就一句话：把复杂的材料，交给讲述的方式重新组织一遍，理解就会深很多。`;
    if (duration >= 15) text += `\n${PODCAST_TEXT_EXPAND_15}`;
    if (duration >= 30) text += `\n${PODCAST_TEXT_EXTEND_30}`;
    text += `\n以上就是今天的分享。如果这些内容对你有启发，欢迎订阅收听，我们下期再见。`;
    const note = `润色说明：已将原文（${src.replace(/\s/g, '').length} 字）改编为口语化讲述结构；保留原文核心要点，补充开场引入与总结收尾。`;
    return { text, note, srcLength: src.replace(/\s/g, '').length };
  }

  // 对话式输入的意图识别：长文本或带润色关键词 → 文本润色；短句 → 话题生成
  function classifyPodcastIntent(input) {
    const t = (input || '').trim();
    const len = t.replace(/\s/g, '').length;
    if (len >= 50) return 'text';
    if (len >= 20 && /(润色|改编|改写|整理)/.test(t)) return 'text';
    return 'topic';
  }

  // 短主题提取：优先「关于/聊聊/谈谈」后的片段，否则截取前 12 字（用于替换进模板与命名）
  function extractTopic(input) {
    const t = (input || '').trim().replace(/\s+/g, '');
    const m = t.match(/(?:关于|聊聊|谈谈|聊一聊|说一说)(.{2,16}?)(?=[。！？?!，,]|的|吧|呢|$)/);
    if (m && m[1]) return m[1];
    return t.slice(0, 12) || '一个值得聊聊的话题';
  }

  // 话题模式时长档位扩充文案（15 分钟：三个论点各追加一句展开；30 分钟：再追加延伸段）
  const PODCAST_TOPIC_EXPAND = [
    ['你随时可以问，随时得到解释。', '具体来说，你可以先给自己提一个真实的问题，再让 AI 围绕这个问题展开解释，学习的过程就从"翻书"变成了"追问"。'],
    ['框架在你的脑子里，细节在工具里。', '一个简单的练习是：每学一个新领域，先逼自己用一页纸画出它的核心概念地图，细节留给工具去补。'],
    ['你负责方向和品味，它负责广度和速度。', '我的习惯是把和 AI 的讨论记录留下来，隔一段时间回看，你会发现自己的判断力在肉眼可见地增长。'],
  ];
  const PODCAST_TOPIC_EXTEND = '再往深一层想：学习方法的变化，背后其实是注意力分配的变化。过去我们把注意力平均撒向整个知识面，如今更像拿着手电筒，照哪里、照多久，完全由你的问题决定。工具越强大，注意力的投向就越稀缺，也越值得被认真设计。这也许是每个学习者最该练习的元能力。';

  function generatePodcast({ mode, topic, text, duration = 5 }) {
    if (mode === 'text') return generatePodcastFromText(text, duration);
    const t = extractTopic(topic);
    let text2 = PODCAST_TOPIC_SCRIPT.replace(/AI 时代的学习方法/g, t);
    if (duration >= 15) {
      PODCAST_TOPIC_EXPAND.forEach(([anchor, extra]) => { text2 = text2.replace(anchor, anchor + extra); });
    }
    if (duration >= 30) {
      text2 = text2.replace('当然，这并不是说基础不重要。', PODCAST_TOPIC_EXTEND + '\n当然，这并不是说基础不重要。');
    }
    return { text: text2, note: `已围绕话题「${t}」生成讲述脚本：开场引入 → 主体内容 → 总结收尾` };
  }

  // ---------- TTS 引擎库（设置页统一配置；id 保持稳定以联动音色库） ----------
  const TTS_ENGINES = [
    { id: 'ali', name: 'Qwen-Audio-TTS', provider: '阿里云', desc: '通义语音合成大模型', mid: 'qwen3-tts-flash' },
    { id: 'volc', name: '火山引擎豆包 TTS', provider: '火山引擎', desc: '豆包语音合成大模型', mid: 'doubao-tts' },
  ];

  function engineById(id) { return TTS_ENGINES.find(e => e.id === id) || TTS_ENGINES[0]; }

  // ---------- TTS 音色库 ----------
  // pitch: 基频(Hz)；wave/brightness/level 供 Web Audio 占位合成使用
  const VOICES = [
    // 阿里云 Qwen-Audio-3.0-TTS
    { id: 'ali_wenrou', engine: 'ali', name: '温柔岚', desc: '温柔女声 · 轻语抚慰', gender: 'female', scenes: ['meditation'], pitch: 208, wave: 'triangle', brightness: 0.9, level: 0.95 },
    { id: 'ali_zhiyue', engine: 'ali', name: '知悦', desc: '知性女声 · 清晰流畅', gender: 'female', scenes: ['podcast'], pitch: 216, wave: 'sawtooth', brightness: 1.15, level: 1.0 },
    { id: 'ali_chenwen', engine: 'ali', name: '沉稳川', desc: '沉稳男声 · 厚重可信', gender: 'male', scenes: ['podcast'], pitch: 118, wave: 'sawtooth', brightness: 0.8, level: 1.05 },
    { id: 'ali_kongyuan', engine: 'ali', name: '空远', desc: '空灵男声 · 缥缈静谧', gender: 'male', scenes: ['meditation'], pitch: 132, wave: 'triangle', brightness: 1.25, level: 0.9 },
    // 火山引擎 豆包 TTS
    { id: 'volc_xiaowan', engine: 'volc', name: '温柔小晚', desc: '温柔女声 · 轻柔舒缓', gender: 'female', scenes: ['meditation'], pitch: 202, wave: 'triangle', brightness: 0.85, level: 0.95 },
    { id: 'volc_yinuo', engine: 'volc', name: '知性一诺', desc: '知性女声 · 从容大方', gender: 'female', scenes: ['podcast'], pitch: 220, wave: 'sawtooth', brightness: 1.1, level: 1.0 },
    { id: 'volc_zimo', engine: 'volc', name: '沉稳子墨', desc: '沉稳男声 · 低沉磁性', gender: 'male', scenes: ['podcast'], pitch: 112, wave: 'sawtooth', brightness: 0.75, level: 1.05 },
    { id: 'volc_qingchuan', engine: 'volc', name: '空灵青川', desc: '空灵男声 · 悠远澄澈', gender: 'male', scenes: ['meditation'], pitch: 128, wave: 'triangle', brightness: 1.3, level: 0.9 },
  ];

  function voiceById(id) { return VOICES.find(v => v.id === id) || VOICES[0]; }

  // ---------- 音乐风格库 ----------
  // chords: MIDI 音高数组；tempo: 每和弦秒数
  const MUSIC_STYLES = [
    {
      id: 'gufeng', name: '古风禅意', color: '#b28cff',
      desc: '五声音阶拨弦，古琴般的留白与余韵',
      keywords: ['古风', '禅意', '笛子', '国风'],
      chords: [[50, 53, 57, 60], [48, 52, 55, 59], [46, 50, 53, 57], [45, 48, 52, 55]],
      instr: 'pluck', wave: 'triangle', tempo: 4.5, decay: 2.2, level: 0.5, filter: 2400, notesPerChord: 5,
    },
    {
      id: 'healing_elec', name: '电子疗愈', color: '#5aa9e6',
      desc: '合成器铺底加律动琶音，通透流动',
      keywords: ['电子', '氛围', '合成器', '赛博'],
      chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
      instr: 'pad', wave: 'sawtooth', tempo: 2.0, decay: 1.0, level: 0.55, filter: 900, arp: true,
    },
    {
      id: 'piano', name: '钢琴抒情', color: '#e6b25a',
      desc: '舒缓钢琴分解和弦，安静克制',
      keywords: ['钢琴', '抒情', '琴键'],
      chords: [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]],
      instr: 'pluck', wave: 'sine', tempo: 3.5, decay: 2.6, level: 0.6, filter: 3200, notesPerChord: 4,
    },
    {
      id: 'nature', name: '自然氛围', color: '#2cc9a7',
      desc: '柔和风声与低频铺底，如临山谷海边',
      keywords: ['自然', '森林', '海浪', '雨', '风'],
      chords: [[45, 52, 57], [43, 50, 55]],
      instr: 'pad', wave: 'sine', tempo: 8.0, decay: 1.5, level: 0.45, filter: 700, noise: true,
    },
    {
      id: 'folk', name: '轻快民谣', color: '#e08a5c',
      desc: '木吉他式拨弦，明亮轻快',
      keywords: ['民谣', '吉他', '轻快', '旅行'],
      chords: [[55, 59, 62], [50, 54, 57], [52, 55, 59], [48, 52, 55]],
      instr: 'pluck', wave: 'triangle', tempo: 2.2, decay: 1.1, level: 0.55, filter: 2800, notesPerChord: 6,
    },
    {
      id: 'deepspace', name: '深空冥想', color: '#6f8cff',
      desc: '极低频持续音，绵长深邃',
      keywords: ['深空', '冥想', '宇宙', '低频'],
      chords: [[33, 40, 45], [31, 38, 43]],
      instr: 'pad', wave: 'sine', tempo: 10.0, decay: 2.0, level: 0.5, filter: 500, noise: true,
    },
  ];

  function styleById(id) { return MUSIC_STYLES.find(s => s.id === id) || MUSIC_STYLES[0]; }

  // 跨风格融合指令解析（关键词 → 附加配器特征）
  function resolveFusion(text) {
    const f = { lead: null, arp: false, noise: false, note: '' };
    if (!text) return f;
    const notes = [];
    if (/笛|箫|flute/i.test(text)) { f.lead = 'flute'; notes.push('笛箫旋律线'); }
    if (/电子|合成|synth|赛博/i.test(text)) { f.arp = true; notes.push('电子琶音'); }
    if (/雨|海|风|自然|森林|水|溪/i.test(text)) { f.noise = true; notes.push('环境底噪'); }
    if (/鼓|节奏|律动|拍子/i.test(text)) { f.arp = true; notes.push('律动加强'); }
    f.note = notes.join(' + ');
    return f;
  }

  // ---------- 剧本生成可选大模型（设置页统一配置） ----------

  const LLM_MODELS = [
    { id: 'deepseek', name: 'DeepSeek', provider: '深度求索', desc: '通用文本生成', mid: 'deepseek-chat' },
    { id: 'kimi', name: 'Kimi', provider: '月之暗面', desc: '长上下文文本生成', mid: 'moonshot-v1-8k' },
    { id: 'qwen', name: '通义千问', provider: '阿里云', desc: '通用文本生成', mid: 'qwen-plus' },
  ];

  function llmById(id) {
    return LLM_MODELS.find(m => m.id === id) || LLM_MODELS[0];
  }

  // ---------- 背景音生成可选音乐模型（设置页统一配置） ----------

  const MUSIC_MODELS = [
    { id: 'minimax-music', name: 'MiniMax music-3.0', provider: 'MiniMax', desc: '音乐生成大模型', mid: 'music-3.0' },
  ];

  function musicModelById(id) {
    return MUSIC_MODELS.find(m => m.id === id) || MUSIC_MODELS[0];
  }

  // 对话式输入的风格识别：按风格 keywords 匹配，未命中走默认风格
  function matchStyle(input) {
    const t = (input || '').replace(/\s+/g, '');
    for (const s of MUSIC_STYLES) {
      if (s.keywords.some(k => t.includes(k))) return { style: s, matched: true };
    }
    return { style: MUSIC_STYLES[0], matched: false };
  }

  // 段落结构解析：从自然语言识别结构关键词，按规范顺序排列；未提及为空（均匀 Loop）
  const STRUCTURE_RULES = [
    { id: 'intro', re: /intro|前奏|引入|开头|铺垫/ },
    { id: 'buildup', re: /build\s*up|递进|渐强|推进/ },
    { id: 'drop', re: /drop|高潮|爆点|能量高点/ },
    { id: 'outro', re: /outro|收尾|结尾|回落|渐弱/ },
  ];

  function parseStructure(input) {
    const t = (input || '').replace(/\s+/g, '');
    return STRUCTURE_RULES.filter(r => r.re.test(t)).map(r => r.id);
  }

  // ---------- 模拟生成任务（进度动画） ----------

  // 按步骤依次点亮，总时长随机落在 [minMs, maxMs]，完成后 resolve
  function fakeTask(steps, { minMs = 1600, maxMs = 2500, onStep } = {}) {
    return new Promise(resolve => {
      const total = minMs + Math.random() * (maxMs - minMs);
      const per = total / steps.length;
      steps.forEach((_, i) => {
        setTimeout(() => onStep && onStep(i), per * i + 30);
      });
      setTimeout(() => { onStep && onStep(steps.length); resolve(); }, total + 150);
    });
  }

  return {
    MEDITATION_TOPICS,
    LLM_MODELS,
    llmById,
    generateMeditation,
    generatePodcast,
    classifyPodcastIntent,
    extractTopic,
    PODCAST_TOPIC_HINT,
    TTS_ENGINES,
    engineById,
    VOICES,
    voiceById,
    MUSIC_STYLES,
    styleById,
    resolveFusion,
    MUSIC_MODELS,
    musicModelById,
    matchStyle,
    parseStructure,
    fakeTask,
  };
})();
