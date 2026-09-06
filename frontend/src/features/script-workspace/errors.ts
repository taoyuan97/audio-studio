/** 失败卡片错误码 → 用户文案（api-contract.md 第 12 节前端处理建议） */
export const RUN_ERROR_TEXT: Record<string, string> = {
  SCRIPT_LLM_NOT_CONFIGURED: '该模型未配置 API Key，请在服务端 .env 中配置后重试',
  SCRIPT_LLM_ERROR: '模型调用失败，请稍后重试',
  SCRIPT_LLM_REQUEST_INVALID: '模型请求参数不兼容，请检查模型 ID 与思考模式设置',
  SCRIPT_LLM_CONTENT_REJECTED: '输入或模型输出触发内容安全限制，请调整内容后重试',
  SCRIPT_LLM_AUTH_ERROR: 'API Key 无效，或 API Key 与接口所属平台不匹配',
  SCRIPT_LLM_ACCESS_DENIED: '当前账号无权调用该模型',
  SCRIPT_LLM_MODEL_NOT_FOUND: '模型不存在或当前账号无权访问',
  SCRIPT_LLM_QUOTA_EXCEEDED: '账户余额或 Token 额度不足',
  SCRIPT_LLM_RATE_LIMITED: '模型繁忙或请求受限，请稍后重试',
  SCRIPT_LLM_STREAM_INCOMPLETE: '模型响应中断，未保存不完整内容，请重试',
  SCRIPT_LLM_OUTPUT_TRUNCATED: '模型输出达到长度上限，未保存不完整内容',
  SCRIPT_TIMEOUT: '模型响应超时，请重试',
  RUN_INTERRUPTED: '服务重启中断，请重新提交',
  RUN_QUEUE_FULL: '任务队列已满，请稍后再试',
}

export function runErrorText(code: string, message: string): string {
  return RUN_ERROR_TEXT[code] ?? message
}
