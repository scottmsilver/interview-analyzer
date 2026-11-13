import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { obj, str } from '@earendil-works/pi-schema';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  RELEASE_SYNC,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
} from 'quickjs-emscripten';
import {
  computeTranscriptMetrics,
  extractQaTurns,
  parseTranscript,
} from './pi-tools.js';

export const SANDBOX_TIMEOUT_MS = 1_000;
export const SANDBOX_PAGE_BYTES = 64 * 1024;
export const SANDBOX_INITIAL_PAGES = 256; // 16 MiB
export const SANDBOX_MEMORY_PAGES = 1_024; // 64 MiB hard cap
export const SANDBOX_MEMORY_CAP_BYTES = SANDBOX_MEMORY_PAGES * SANDBOX_PAGE_BYTES;
export const SANDBOX_STACK_BYTES = 512 * 1024; // 512 KiB
export const SANDBOX_MAX_CODE_CHARS = 20_000;
export const SANDBOX_MAX_OUTPUT_CHARS = 8_000;
export const SANDBOX_MAX_LOG_LINE_CHARS = 2_000;
export const SANDBOX_MAX_LOG_LINES = 200;
export const SANDBOX_MAX_ERROR_CHARS = 500;

declare const WebAssembly: {
  Memory: new (descriptor: { initial: number; maximum?: number; shared?: boolean }) => unknown;
};

function freshEngine() {
  const wasmMemory = new WebAssembly.Memory({
    initial: SANDBOX_INITIAL_PAGES,
    maximum: SANDBOX_MEMORY_PAGES,
  });
  return newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmMemory }));
}

function boundedString(ctx: QuickJSContext, h: QuickJSHandle | undefined, max: number, what: string): string {
  if (!h || ctx.typeof(h) !== 'string') {
    throw new Error(`${what} must be a string`);
  }
  const len = ctx.getProp(h, 'length');
  const n = ctx.getNumber(len);
  len.dispose();
  if (n > max) {
    throw new Error(`${what} longer than ${max} characters`);
  }
  return ctx.getString(h);
}

function describeError(ctx: QuickJSContext, h: QuickJSHandle): string {
  const part = (key: string) => {
    const v = ctx.getProp(h, key);
    try {
      return ctx.typeof(v) === 'string' ? boundedString(ctx, v, SANDBOX_MAX_ERROR_CHARS, key) : '';
    } catch {
      return '(too long)';
    } finally {
      v.dispose();
    }
  };
  if (ctx.typeof(h) === 'string') {
    try {
      return boundedString(ctx, h, SANDBOX_MAX_ERROR_CHARS, 'error');
    } catch {
      return '(error too long)';
    }
  }
  if (ctx.typeof(h) !== 'object') {
    return `thrown ${ctx.typeof(h)}`;
  }
  return `${part('name') || 'Error'}: ${part('message')}`;
}

export type SandboxResult =
  | { ok: true; result: unknown; logs: string[] }
  | { ok: false; error: string; logs: string[] };

export async function runSandboxedTranscriptJs(
  code: string,
  data: {
    transcript: string;
    turns: unknown[];
    metrics: unknown;
    qaPairs: unknown[];
  },
  timeoutMs: number = SANDBOX_TIMEOUT_MS,
): Promise<SandboxResult> {
  const logs: string[] = [];
  if (typeof code !== 'string' || code.length === 0) {
    return { ok: false, error: 'code must be a non-empty string', logs };
  }
  if (code.length > SANDBOX_MAX_CODE_CHARS) {
    return { ok: false, error: `code longer than ${SANDBOX_MAX_CODE_CHARS} characters`, logs };
  }

  const runtime = (await freshEngine()).newRuntime();
  runtime.setMaxStackSize(SANDBOX_STACK_BYTES);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));
  const ctx = runtime.newContext();
  const fail = (error: string): SandboxResult => ({ ok: false, error, logs });

  try {
    const logFn = ctx.newFunction('__log', (lineHandle) => {
      try {
        const s = boundedString(ctx, lineHandle, SANDBOX_MAX_LOG_LINE_CHARS, 'log line');
        if (logs.length < SANDBOX_MAX_LOG_LINES) {
          logs.push(s);
        } else if (logs.length === SANDBOX_MAX_LOG_LINES) {
          logs.push('… (more log lines dropped)');
        }
        return ctx.undefined;
      } catch (e) {
        return { error: ctx.newError(String((e as Error).message).slice(0, SANDBOX_MAX_ERROR_CHARS)) };
      }
    });
    ctx.setProp(ctx.global, '__log', logFn);
    logFn.dispose();

    const jsonHandle = ctx.newString(JSON.stringify(data));
    ctx.setProp(ctx.global, '__data', jsonHandle);
    jsonHandle.dispose();

    const setup = ctx.evalCode(
      `(() => {
        const log = globalThis.__log, cap = ${SANDBOX_MAX_LOG_LINE_CHARS};
        const fmt = (x) => { try { return typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); } };
        globalThis.console = { log: (...a) => log(String(a.map(fmt).join(" ")).slice(0, cap)) };
        delete globalThis.__log;
        const d = JSON.parse(globalThis.__data); delete globalThis.__data;
        const deepFreeze = (o) => {
          if (o && typeof o === "object") {
            for (const v of Object.values(o)) deepFreeze(v);
            Object.freeze(o);
          }
          return o;
        };
        for (const [k, v] of Object.entries(d)) {
          Object.defineProperty(globalThis, k, { value: deepFreeze(v), writable: false, configurable: false });
        }
        const stringify = JSON.stringify;
        return (r) => { const s = stringify(r); return s === undefined ? "null" : s; };
      })()`,
    );

    if (setup.error) {
      const e = describeError(ctx, setup.error);
      setup.error.dispose();
      return fail(`sandbox setup failed: ${e}`);
    }

    const finish = setup.value;
    const res = ctx.evalCode(code, 'transcript-sandbox.js');
    if (res.error) {
      finish.dispose();
      const e = describeError(ctx, res.error);
      res.error.dispose();
      return fail(e);
    }

    const out = ctx.callFunction(finish, ctx.undefined, res.value);
    finish.dispose();
    res.value.dispose();
    if (out.error) {
      const e = describeError(ctx, out.error);
      out.error.dispose();
      return fail(`result is not JSON: ${e}`);
    }

    try {
      const serialized = boundedString(ctx, out.value, SANDBOX_MAX_OUTPUT_CHARS, 'result (as JSON)');
      return { ok: true, result: JSON.parse(serialized), logs };
    } catch (e) {
      return fail(`${(e as Error).message}; return a smaller JSON value`);
    } finally {
      out.value.dispose();
    }
  } finally {
    try {
      ctx.dispose();
      runtime.dispose();
    } catch {
      // Ignore dispose failures after OOM/interrupt aborts
    }
  }
}

const RunTranscriptJsParamsSchema = obj({
  code: str({
    description:
      'JavaScript snippet to execute in a 64 MiB / 1000ms QuickJS WASM sandbox with zero FS/network/env access. Read-only frozen globals available: `transcript` (string), `turns` (parsed turns), `metrics` (computed metrics), `qaPairs` (extracted Q&A blocks), and `console.log`. The final expression value is returned as JSON.',
  }),
});

export function createRunTranscriptJsTool(
  getTranscript: () => string,
  recordToolCall?: (name: string) => void,
): AgentTool<typeof RunTranscriptJsParamsSchema> {
  return {
    name: 'run_transcript_js',
    label: 'Run transcript JavaScript analysis',
    description:
      'Execute deterministic JavaScript in an isolated QuickJS WASM sandbox (64 MiB cap, 512 KiB stack, 1000ms timeout, no FS/network/env) over deep-frozen globals `{ transcript, turns, metrics, qaPairs }` to verify exact word counts, quote matches, pronoun ratios, or timeline math.',
    parameters: RunTranscriptJsParamsSchema,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const transcript = getTranscript();
      const parsed = parseTranscript(transcript);
      const metrics = computeTranscriptMetrics(transcript);
      const qaPairs = extractQaTurns(transcript);

      const r = await runSandboxedTranscriptJs(String(params?.code ?? ''), {
        transcript,
        turns: parsed.turns,
        metrics,
        qaPairs,
      });

      recordToolCall?.('run_transcript_js');

      if (!r.ok) {
        const errorText = [r.error, ...r.logs.map((l) => `log: ${l}`)].join('\n').slice(0, SANDBOX_MAX_OUTPUT_CHARS);
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: errorText }) }],
          details: {},
          isError: true,
        };
      }

      const out = JSON.stringify({ result: r.result ?? null, logs: r.logs });
      return {
        content: [
          {
            type: 'text',
            text: out.length > SANDBOX_MAX_OUTPUT_CHARS ? out.slice(0, SANDBOX_MAX_OUTPUT_CHARS) + '… (truncated)' : out,
          },
        ],
        details: {},
        isError: false,
      };
    },
  };
}
