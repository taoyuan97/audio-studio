"""ffmpeg/ffprobe 子进程封装：路径探测、可用性、执行（超时与错误归一化）。"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class FFmpegError(RuntimeError):
    pass


def find_ffmpeg(ffmpeg_path: str = "") -> str | None:
    """优先 FFMPEG_PATH 配置，其次 PATH 探测；找不到返回 None。"""
    if ffmpeg_path:
        candidate = Path(ffmpeg_path)
        try:
            if candidate.is_file():
                return str(candidate)
        except OSError:
            return None
        resolved = shutil.which(ffmpeg_path)
        return str(resolved) if resolved else None
    resolved = shutil.which("ffmpeg")
    return str(resolved) if resolved else None


def find_ffprobe(ffmpeg_path: str = "") -> str | None:
    if ffmpeg_path:
        configured = Path(ffmpeg_path)
        # 显式配置 ffmpeg.exe 时，Windows 同目录探针也必须保留 .exe；
        # Linux/macOS 的无扩展名配置仍拼为 ffprobe。
        sibling = configured.with_name(f"ffprobe{configured.suffix}")
        try:
            if sibling.is_file():
                return str(sibling)
        except OSError:
            return None
    resolved = shutil.which("ffprobe")
    return str(resolved) if resolved else None


def ffmpeg_version(ffmpeg_path: str = "") -> str | None:
    binary = find_ffmpeg(ffmpeg_path)
    if binary is None:
        return None
    try:
        completed = subprocess.run(
            [binary, "-version"], capture_output=True, text=True, timeout=10
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    first_line = (completed.stdout or "").splitlines()
    return first_line[0] if first_line else None


def run_ffmpeg(ffmpeg_path: str, args: list[str], *, timeout: float = 300) -> subprocess.CompletedProcess[str]:
    """执行 ffmpeg 命令；失败/超时抛 FFmpegError（stderr 截断脱敏）。"""
    binary = find_ffmpeg(ffmpeg_path)
    if binary is None:
        raise FFmpegError("ffmpeg 不可用，请安装后重试")
    cmd = [binary, *args]
    try:
        completed = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError(f"ffmpeg 执行超时（{timeout}s）") from exc
    except OSError as exc:
        raise FFmpegError(f"ffmpeg 启动失败: {exc}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or "").strip().splitlines()
        raise FFmpegError(detail[-1] if detail else f"ffmpeg 退出码 {completed.returncode}")
    return completed
