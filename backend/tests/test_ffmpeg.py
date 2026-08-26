"""ffmpeg/ffprobe 路径发现回归测试。"""

from pathlib import Path

from app.ffmpeg import find_ffprobe


def test_find_ffprobe_keeps_configured_executable_suffix(tmp_path: Path):
    ffmpeg = tmp_path / "ffmpeg.exe"
    ffprobe = tmp_path / "ffprobe.exe"
    ffmpeg.touch()
    ffprobe.touch()

    assert find_ffprobe(str(ffmpeg)) == str(ffprobe)
