import type Anthropic from '@anthropic-ai/sdk';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { type AnthropicEffort, type AnthropicOptions, stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAI } from '@earendil-works/pi-ai/api/openai-completions';
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { createAnthropicClient } from './analyzer.js';

export const PROVIDER_ID = 'manifest';
export const DEFAULT_PI_MAX_OUTPUT_TOKENS = 32_000;

export type PiApiMode = 'anthropic-messages' | 'openai-completions';

export function resolvePiApiMode(modelId: string, rawMode?: string): PiApiMode {
  const mode = (rawMode ?? process.env.PI_LLM_API ?? '').trim().toLowerCase();
  if (mode === 'openai-completions' || mode === 'openai') {
    return 'openai-completions';
  }
  if (mode === 'anthropic-messages' || mode === 'anthropic') {
    return 'anthropic-messages';
  }

  const normalizedModel = (modelId || '').trim().toLowerCase();
  if (/^(?:gpt-|o1(?:$|[-_.])|o3(?:$|[-_.])|o4(?:$|[-_.]))/.test(normalizedModel)) {
    return 'openai-completions';
  }

  return 'anthropic-messages';
}

export function normalizePiBaseUrl(rawUrl: string, apiMode: PiApiMode): string {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return apiMode === 'openai-completions'
      ? 'https://api.openai.com/v1'
      : 'https://api.anthropic.com';
  }
  if (apiMode === 'anthropic-messages') {
    return trimmed.replace(/\/v1$/i, '');
  }
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function createPiModel(
  baseUrl: string,
  modelId: string,
  apiMode: PiApiMode = resolvePiApiMode(modelId),
): Model<'anthropic-messages'> | Model<'openai-completions'> {
  const normalizedUrl = normalizePiBaseUrl(baseUrl, apiMode);

  if (apiMode === 'openai-completions') {
    return {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: PROVIDER_ID,
      baseUrl: normalizedUrl,
      reasoning: /^(?:gpt-5|o1|o3|o4)/i.test(modelId),
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: DEFAULT_PI_MAX_OUTPUT_TOKENS,
    };
  }

  const known = anthropicProvider()
    .getModels()
    .find((m) => m.id === modelId) as Model<'anthropic-messages'> | undefined;

  return {
    id: modelId,
    name: known?.name ?? modelId,
    api: 'anthropic-messages',
    provider: PROVIDER_ID,
    baseUrl: normalizedUrl,
    reasoning: known?.reasoning ?? true,
    input: known?.input ?? ['text', 'image'],
    cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: known?.contextWindow ?? 200_000,
    maxTokens: Math.max(known?.maxTokens ?? DEFAULT_PI_MAX_OUTPUT_TOKENS, DEFAULT_PI_MAX_OUTPUT_TOKENS),
    thinkingLevelMap: known?.thinkingLevelMap,
    compat: {
      forceAdaptiveThinking: known?.compat?.forceAdaptiveThinking ?? true,
      supportsTemperature: false,
    },
  };
}

export function effortFor(
  model: Pick<Model<'anthropic-messages'>, 'thinkingLevelMap'>,
  chosenEffort: AnthropicEffort = 'high',
): AnthropicEffort {
  const map = model.thinkingLevelMap;
  const mapped = map?.[chosenEffort];
  if (mapped === null) {
    if (typeof map?.xhigh === 'string') return map.xhigh as AnthropicEffort;
    if (typeof map?.max === 'string') return map.max as AnthropicEffort;
    return 'xhigh';
  }
  if (typeof mapped === 'string') {
    return mapped as AnthropicEffort;
  }
  return chosenEffort;
}

export interface CreatePiStreamFnOptions {
  apiMode?: PiApiMode;
  maxOutputTokens?: number;
  client?: Anthropic;
  apiKey?: string;
  headers?: Record<string, string>;
  effort?: AnthropicEffort;
  thinkingEnabled?: boolean;
}

export function createPiStreamFn(optionsOrMode: CreatePiStreamFnOptions | PiApiMode = {}): StreamFn {
  const opts: CreatePiStreamFnOptions =
    typeof optionsOrMode === 'string' ? { apiMode: optionsOrMode } : optionsOrMode;
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_PI_MAX_OUTPUT_TOKENS;
  const effort: AnthropicEffort = opts.effort ?? 'high';
  const defaultThinkingEnabled = opts.thinkingEnabled ?? true;

  return (model, context, streamOptions) => {
    const mode = opts.apiMode ?? resolvePiApiMode(model.id);

    if (mode === 'openai-completions') {
      const apiKey =
        opts.apiKey ||
        process.env.ANTHROPIC_AUTH_TOKEN ||
        process.env.OPENAI_API_KEY ||
        process.env.ANTHROPIC_API_KEY;
      const manifestAuthType = process.env.MANIFEST_AUTH_TYPE?.trim();
      const mergedHeaders: Record<string, string> = {
        ...(manifestAuthType ? { 'x-manifest-auth-type': manifestAuthType } : {}),
        ...(opts.headers ?? {}),
        ...(streamOptions?.headers as Record<string, string> | undefined),
      };

      return streamOpenAI(model as Model<'openai-completions'>, context, {
        ...streamOptions,
        apiKey,
        ...(Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
        maxTokens: clampMaxTokensToContext(model, context, maxOutputTokens),
      });
    }

    // In anthropic-messages mode, when ANTHROPIC_AUTH_TOKEN is set (or an explicit
    // client is provided), pass `client: createAnthropicClient(model.baseUrl)` and omit `apiKey`
    // so pi-ai does not construct `new Anthropic({ apiKey })` with `x-api-key`.
    const hasAuthToken = Boolean(process.env.ANTHROPIC_AUTH_TOKEN);
    const client = opts.client ?? (hasAuthToken ? createAnthropicClient(model.baseUrl || undefined) : undefined);
    const apiKey = client
      ? undefined
      : opts.apiKey ?? process.env.ANTHROPIC_API_KEY;

    const mergedHeaders: Record<string, string> = {
      ...(opts.headers ?? {}),
      ...(streamOptions?.headers as Record<string, string> | undefined),
    };

    const thinkingEnabled = defaultThinkingEnabled;
    const resolvedEffort = effortFor(model as Model<'anthropic-messages'>, effort);

    return streamAnthropic(model as Model<'anthropic-messages'>, context, {
      ...streamOptions,
      ...(client ? { client: client as unknown as NonNullable<AnthropicOptions['client']> } : { apiKey }),
      ...(Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
      maxTokens: clampMaxTokensToContext(model, context, maxOutputTokens),
      cacheRetention: 'long',
      thinkingEnabled,
      ...(thinkingEnabled
        ? {
            effort: resolvedEffort,
            thinkingDisplay: 'summarized' as const,
          }
        : {}),
    });
  };
}
