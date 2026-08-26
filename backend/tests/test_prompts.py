"""冥想 Prompt 时长档位测试。"""

import pytest

from app.script.prompts import DURATION_WORD_TARGETS, build_user_prompt


@pytest.mark.parametrize(
    ("duration", "word_target"),
    [(5, 1200), (10, 2200), (15, 3200), (20, 4200), (25, 5100), (30, 6000)],
)
def test_duration_word_targets(duration: int, word_target: int):
    assert DURATION_WORD_TARGETS[duration] == word_target
    prompt = build_user_prompt("深海放松", duration)
    assert f"目标时长 {duration} 分钟" in prompt
    assert f"正文约 {word_target} 字" in prompt
