/** 失败卡片错误码 → 用户文案（api-contract.md 第 12 节前端处理建议） */
export const RUN_ERROR_TEXT: Record<string, string> = {
  SCRIPT_LLM_NOT_CONFIGURED: '该模型未配置 API Key，请在服务端 .env 中配置后重试',
  SCRIPT_LLM_ERROR: '模型调用失败，请稍后重试',
  SCRIPT_TIMEOUT: '模型响应超时，请重试',
  RUN_INTERRUPTED: '服务重启中断，请重新提交',
  RUN_QUEUE_FULL: '任务队列已满，请稍后再试',
}

export function runErrorText(code: string, message: string): string {
  return RUN_ERROR_TEXT[code] ?? message
}
