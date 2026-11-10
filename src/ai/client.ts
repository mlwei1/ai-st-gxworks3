/**
 * LLM 客户端 —— 通过 Anthropic 兼容接口调用模型。
 *
 * 优先读取环境变量（ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL），
 * 这与 MCode 运行时保持一致，因此无需额外配置即可工作。
 */

import { buildSystemPrompt, buildUserPrompt } from './prompt.ts';

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface GenerateOptions {
  /** 控制需求描述。 */
  requirement: string;
  /** IO 分配表。 */
  ioTable?: string;
  /** 已有变量清单。 */
  existingVariables?: string;
  /** 目标 CPU 系列。 */
  target?: 'FX5U' | 'iQ-R';
  /** 最大尝试次数（含首次）。 */
  maxAttempts?: number;
}

/** 从环境变量读取配置。 */
export function loadLLMConfig(): LLMConfig {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '';
  const model = process.env.ANTHROPIC_MODEL ?? 'MiniMax-M3';
  if (!baseUrl || !apiKey) {
    throw new Error(
      '未配置 LLM 凭据。请设置环境变量 ANTHROPIC_BASE_URL 与 ANTHROPIC_AUTH_TOKEN。',
    );
  }
  return { baseUrl, apiKey, model, maxTokens: 16000, temperature: 0.2, timeoutMs: 600000 };
}

/** 调用 LLM，返回文本。 */
export async function callLLM(
  config: LLMConfig,
  system: string,
  user: string,
): Promise<string> {
  const url = `${config.baseUrl}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 600000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens ?? 16000,
        temperature: config.temperature ?? 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 5xx 与 429 属于服务端/限流问题，重试有意义；4xx 是请求本身的问题
      const retryable = res.status >= 500 || res.status === 429;
      const err = new Error(
        `LLM 请求失败 HTTP ${res.status}${retryable ? '（可重试）' : ''}: ${body.slice(0, 500)}`,
      );
      (err as Error & { retryable?: boolean }).retryable = retryable;
      throw err;
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    if (!text) throw new Error('LLM 返回内容为空');
    return text;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('LLM 请求超时');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 从可能带 markdown 包裹的文本中提取 JSON。 */
export function extractJson(text: string): string {
  let t = text.trim();
  // 去掉 ```json ... ``` 包裹
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  // 找到第一个 { 到最后一个 }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`LLM 输出中找不到 JSON 对象：${t.slice(0, 300)}`);
  }
  return t.slice(start, end + 1);
}

/**
 * 生成 ST 代码，并返回解析后的结构。
 *
 * 内置重试：若模型输出无法解析为 JSON，会带着错误信息重试，
 * 让模型自我修正（这是结构化生成最有效的重试策略）。
 */
export async function generateST(
  options: GenerateOptions,
  config: LLMConfig = loadLLMConfig(),
): Promise<{ json: unknown; raw: string; attempts: number }> {
  const maxAttempts = options.maxAttempts ?? 3;
  const system = buildSystemPrompt(options.target ?? 'FX5U');
  let user = buildUserPrompt(options.requirement, {
    ioTable: options.ioTable,
    existingVariables: options.existingVariables,
    target: options.target ?? 'FX5U',
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await callLLM(config, system, user);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const retryable =
        (e as Error & { retryable?: boolean })?.retryable === true ||
        lastError.message.includes('超时') ||
        lastError.message.includes('fetch failed');
      if (attempt >= maxAttempts || !retryable) break;
      const backoff = attempt * 2000;
      console.error(`  ▲ 第 ${attempt} 次调用失败（${lastError.message}），${backoff / 1000}s 后重试`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    try {
      const json = JSON.parse(extractJson(raw));
      return { json, raw, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // 把错误反馈给模型，让它修正格式
      user = `${user}\n\n【重要】上一次输出无法被解析为 JSON：${lastError.message}\n请只输出合法 JSON，不要任何其他内容。`;
    }
  }

  throw new Error(
    `AI 生成失败（已尝试 ${maxAttempts} 次）：${lastError?.message ?? '未知错误'}`,
  );
}
