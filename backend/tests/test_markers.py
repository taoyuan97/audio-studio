"""markers 解析测试（T003 验收：全标记类型/组合/非法标记容错/est_duration 计算）。"""

from __future__ import annotations

import pytest

from app.script.markers import (
    BREATH_SECONDS,
    SYLLABLE_SECONDS,
    parse_script,
)


class TestSegmentParsing:
    def test_plain_text_single_speech(self):
        parsed = parse_script("欢迎来到放松练习")
        assert parsed.segments == [
            {"kind": "speech", "text": "欢迎来到放松练习", "emotion": None, "speed": None}
        ]

    def test_pause_marker(self):
        parsed = parse_script("第一段 [停顿 3s] 第二段")
        assert parsed.segments == [
            {"kind": "speech", "text": "第一段", "emotion": None, "speed": None},
            {"kind": "pause", "seconds": 3.0},
            {"kind": "speech", "text": "第二段", "emotion": None, "speed": None},
        ]

    def test_pause_decimal_seconds(self):
        parsed = parse_script("[停顿 2.5s]")
        assert parsed.segments == [{"kind": "pause", "seconds": 2.5}]

    def test_breath_markers(self):
        parsed = parse_script("[吸气] 一次呼吸 [呼气]")
        kinds = [(seg["kind"], seg.get("seconds")) for seg in parsed.segments]
        assert kinds == [
            ("pause", BREATH_SECONDS["吸气"]),
            ("speech", None),
            ("pause", BREATH_SECONDS["呼气"]),
        ]

    def test_emotion_speed_state_carries_forward(self):
        parsed = parse_script(
            "开头 [情绪:温柔] 温柔段落 [语速:慢速] 慢速段落"
        )
        speeches = [seg for seg in parsed.segments if seg["kind"] == "speech"]
        assert len(speeches) == 3
        assert speeches[0]["emotion"] is None
        assert speeches[1]["emotion"] == "温柔"
        assert speeches[1]["speed"] is None
        assert speeches[2]["emotion"] == "温柔"
        assert speeches[2]["speed"] == "慢速"

    def test_emotion_override(self):
        parsed = parse_script("[情绪:温柔] A [情绪:平静] B")
        speeches = [seg for seg in parsed.segments if seg["kind"] == "speech"]
        assert speeches[0]["emotion"] == "温柔"
        assert speeches[1]["emotion"] == "平静"

    def test_native_emotion_and_vocal_markers(self):
        parsed = parse_script("开头 [emotion:ASMR] 轻声 [vocal:sighing] 继续")
        assert parsed.segments == [
            {"kind": "speech", "text": "开头", "emotion": None, "speed": None},
            {"kind": "speech", "text": "轻声", "emotion": "asmr", "speed": None},
            {"kind": "vocal", "tag": "sighing"},
            {"kind": "speech", "text": "继续", "emotion": "asmr", "speed": None},
        ]

    def test_unconfigured_native_marker_is_preserved(self):
        parsed = parse_script("[emotion:custom calm] 正文 [vocal:soft-breath]")
        assert parsed.segments[0]["emotion"] == "custom calm"
        assert parsed.segments[1] == {"kind": "vocal", "tag": "soft-breath"}

    def test_full_combination(self):
        text = (
            "欢迎 [情绪:温柔] [语速:慢速] 请闭眼 [停顿 4s] "
            "[吸气] 感受呼吸 [呼气] [停顿 2s] 结束"
        )
        parsed = parse_script(text)
        kinds = [seg["kind"] for seg in parsed.segments]
        assert kinds.count("speech") == 4
        assert kinds.count("pause") == 4
        # 标记之后的 speech 继承状态（首段在标记之前，保持 None）
        speeches = [seg for seg in parsed.segments if seg["kind"] == "speech"]
        assert speeches[0]["emotion"] is None
        for seg in speeches[1:]:
            assert seg["emotion"] == "温柔"
            assert seg["speed"] == "慢速"

    def test_invalid_markers_tolerated(self):
        """非法标记（无法识别的 []）被剔除，不中断解析。"""
        parsed = parse_script("前段 [未知标记] [停顿 1s] 后段")
        assert parsed.segments == [
            {"kind": "speech", "text": "前段", "emotion": None, "speed": None},
            {"kind": "pause", "seconds": 1.0},
            {"kind": "speech", "text": "后段", "emotion": None, "speed": None},
        ]

    def test_invalid_speed_value_ignored(self):
        parsed = parse_script("[语速:光速] 正文")
        assert parsed.segments[0]["speed"] is None

    def test_invalid_pause_ignored(self):
        parsed = parse_script("[停顿 0s] 正文")
        assert parsed.segments == [
            {"kind": "speech", "text": "正文", "emotion": None, "speed": None}
        ]

    def test_empty_text(self):
        parsed = parse_script("")
        assert parsed.segments == []
        assert parsed.est_duration == 0.0

    def test_whitespace_collapsed_between_markers(self):
        parsed = parse_script("[情绪:温柔]\n\n[停顿 2s]\n\n正文")
        speeches = [seg for seg in parsed.segments if seg["kind"] == "speech"]
        assert speeches == [
            {"kind": "speech", "text": "正文", "emotion": "温柔", "speed": None}
        ]

    def test_unclosed_bracket_is_plain_text(self):
        parsed = parse_script("前段 [停顿 3s 后段")
        assert parsed.segments == [
            {
                "kind": "speech",
                "text": "前段 [停顿 3s 后段",
                "emotion": None,
                "speed": None,
            }
        ]


class TestEstDuration:
    def test_speech_only(self):
        text = "一二三四五"  # 5 个音节
        parsed = parse_script(text)
        assert parsed.est_duration == pytest.approx(5 * SYLLABLE_SECONDS)

    def test_pause_summed(self):
        text = "一 [停顿 2s] 二 [停顿 3s]"
        parsed = parse_script(text)
        expected = 2 * SYLLABLE_SECONDS + 5.0
        assert parsed.est_duration == pytest.approx(expected)

    def test_breath_constants(self):
        parsed = parse_script("[吸气] [呼气]")
        assert parsed.est_duration == pytest.approx(
            BREATH_SECONDS["吸气"] + BREATH_SECONDS["呼气"]
        )

    def test_slow_speed_extends_duration(self):
        normal = parse_script("[语速:正常] 一二三四五")
        slow = parse_script("[语速:慢速] 一二三四五")
        assert slow.est_duration > normal.est_duration
        assert slow.est_duration == pytest.approx(normal.est_duration / 0.72)

    def test_as_content_structure(self):
        parsed = parse_script("你好 [停顿 2s]")
        content = parsed.as_content()
        assert set(content) == {"segments", "est_duration"}
        assert content["est_duration"] == pytest.approx(
            2 * SYLLABLE_SECONDS + 2.0, abs=0.1
        )

    def test_latin_and_digits_counted(self):
        parsed = parse_script("abc 123 你好")
        # abc=1 词 + 123=1 词 + 2 汉字 = 4 音节
        assert parsed.est_duration == pytest.approx(4 * SYLLABLE_SECONDS)
