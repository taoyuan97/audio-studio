"""FAKE_MODE 内置示例冥想脚本（按 duration 档位缩放停顿，语义移植自原型 mock.js）。

供伪流式输出使用：LLM Key 未配置 / 开发联调 / 自动化测试。
"""

from __future__ import annotations

import re

FAKE_SCRIPTS: dict[str, str] = {
    "深海放松": """欢迎来到今天的深海放松练习。[情绪:温柔]
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
慢慢地睁开眼睛，把这份平静带回你的日常。""",
    "焦虑缓解": """欢迎来到今天的焦虑缓解练习。[情绪:温柔]
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
你不需要立刻解决所有问题，此刻只需要照顾好自己。[情绪:温柔]
[停顿 10s]
[呼气] 再做最后一次深呼吸。
[停顿 4s]
当你准备好了，慢慢睁开眼睛，带着这份松弛回到此刻。""",
    "睡眠引导": """晚上好，欢迎来到今晚的睡眠引导。[情绪:温柔]
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
安心地睡吧，晚安。""",
}

# 主题匹配关键词（自由输入命中则用对应模板，否则用默认并替换主题词）
_TOPIC_KEYWORDS = {
    "深海放松": ["深海", "海洋", "海水", "放松"],
    "焦虑缓解": ["焦虑", "紧张", "压力", "缓解"],
    "睡眠引导": ["睡眠", "入睡", "睡前", "晚安"],
}

# 时长档位 → 停顿缩放系数（目标时长越长，静默间隙越长）
_DURATION_SCALE = {5: 1.0, 10: 1.3, 15: 1.6, 20: 1.9, 25: 2.1, 30: 2.4}

_PAUSE_RE = re.compile(r"\[停顿\s*(\d+(?:\.\d+)?)s\]")


def _scale_pauses(text: str, factor: float) -> str:
    if factor == 1.0:
        return text
    return _PAUSE_RE.sub(
        lambda m: f"[停顿 {round(float(m.group(1)) * factor)}s]", text
    )


def generate_fake_script(text: str, duration: int) -> tuple[str, str]:
    """按用户输入与时长档位生成示例脚本，返回 (脚本文本, 命中主题)。"""
    stripped = (text or "").strip()
    matched = next(
        (topic for topic, keywords in _TOPIC_KEYWORDS.items()
         if any(keyword in stripped for keyword in keywords)),
        "深海放松",
    )
    script = FAKE_SCRIPTS[matched]
    # 将脚本首句的主题词替换为用户输入的主题（截断到 10 字）
    topic_display = stripped[:10] if stripped else matched
    script = re.sub(
        r"(欢迎来到今天的)([^练\n]{2,10})(练习|冥想)",
        lambda m: f"{m.group(1)}{topic_display}{m.group(3)}",
        script,
        count=1,
    )
    script = _scale_pauses(script, _DURATION_SCALE.get(duration, 1.0))
    return script, matched
