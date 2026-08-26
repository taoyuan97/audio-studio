/** 预估口播时长格式化（与后端 est_duration 展示对齐） */
export function formatEstDuration(seconds: number): string {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes === 0) return `${rest} 秒`
  return `${minutes} 分 ${rest.toString().padStart(2, '0')} 秒`
}
