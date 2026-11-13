import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { int, obj, opt, str } from '@earendil-works/pi-schema';

export const MAX_WEB_FETCH_BYTES = 2 * 1024 * 1024; // 2 MiB
export const WEB_FETCH_TIMEOUT_MS = 10_000; // 10s
export const MAX_WEB_REDIRECTS = 4;
export const MAX_WEB_FETCH_CHARS = 20_000;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  hellip: '…',
};

export function decodeHtmlEntities(raw: string): string {
  if (!raw || !raw.includes('&')) return raw;
  return raw
    .replace(/&#39;/g, "'")
    .replace(/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]+));/g, (full, dec, hex, named) => {
      if (dec !== undefined) {
        const code = Number.parseInt(dec, 10);
        if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
          return String.fromCodePoint(code);
        }
        return full;
      }
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
          return String.fromCodePoint(code);
        }
        return full;
      }
      if (named !== undefined) {
        const mapped = NAMED_HTML_ENTITIES[named] ?? NAMED_HTML_ENTITIES[named.toLowerCase()];
        return mapped !== undefined ? mapped : full;
      }
      return full;
    });
}

function cleanInlineText(rawHtml: string): string {
  return decodeHtmlEntities(
    rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripHtmlToText(rawHtml: string, maxChars: number = MAX_WEB_FETCH_CHARS): string {
  const bodyMatch = rawHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? rawHtml;
  const cleaned = decodeHtmlEntities(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return cleaned.slice(0, maxChars) + '\n...[truncated]';
}

function isPrivateIpv4Parts(parts: number[]): boolean {
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10.0.0.0/8, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // Link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function parseIpv6Groups(raw: string): number[] | null {
  let addr = raw.toLowerCase();
  const zoneIdx = addr.indexOf('%');
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  const lastColon = addr.lastIndexOf(':');
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes('.')) {
    const ipv4Str = addr.slice(lastColon + 1);
    const v4 = ipv4Str.split('.').map((n) => Number.parseInt(n, 10));
    if (v4.length !== 4 || v4.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return null;
    }
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const dblParts = addr.split('::');
  if (dblParts.length > 2) return null;

  const parseSide = (s: string): number[] | null => {
    if (!s) return [];
    const tokens = s.split(':');
    const nums: number[] = [];
    for (const t of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
      nums.push(Number.parseInt(t, 16));
    }
    return nums;
  };

  if (dblParts.length === 1) {
    const groups = parseSide(dblParts[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = parseSide(dblParts[0]);
  const right = parseSide(dblParts[1]);
  if (!left || !right || left.length + right.length >= 8) return null;
  const zeros = new Array<number>(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

export function isPrivateIpAddress(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '');
  const version = isIP(ip);
  if (version === 4) {
    return isPrivateIpv4Parts(ip.split('.').map((n) => Number.parseInt(n, 10)));
  }
  if (version === 6) {
    const g = parseIpv6Groups(ip);
    if (!g) return true;
    const isAllZero = g.every((x) => x === 0);
    const isLoopback = g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
    if (isAllZero || isLoopback) return true;
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 Link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 Multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // Documentation
    const isV4Mapped = g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0);
    const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
    if (isV4Mapped || isNat64) {
      const v4Parts = [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];
      return isPrivateIpv4Parts(v4Parts);
    }
    return false;
  }
  return true;
}

export type PublicDnsResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export interface PublicFetchOptions {
  maxRedirects?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string | Buffer;
  timeoutMs?: number;
  /** Internal test-only DNS resolver (still validated through isPrivateIpAddress). */
  _testResolver?: PublicDnsResolver;
  /** Internal test-only TCP target override used ONLY after public endpoint validation succeeds. */
  _testConnectOverride?: { host: string; port: number };
}

export function isBlockedHostname(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  return (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan')
  );
}

export async function resolveValidatedPublicEndpoint(
  rawUrl: string,
  customResolver?: PublicDnsResolver,
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported protocol "${parsed.protocol}" (only http/https allowed)`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (isBlockedHostname(host)) {
    throw new Error(`Refusing internal host "${host}"`);
  }
  if (parsed.hostname.endsWith('.')) {
    parsed.hostname = host;
  }
  const ipVer = isIP(host);
  if (ipVer === 4 || ipVer === 6) {
    if (isPrivateIpAddress(host)) {
      throw new Error(`Refusing private/loopback IP "${host}"`);
    }
    return { url: parsed, address: host, family: ipVer };
  }
  const records = customResolver
    ? await customResolver(host)
    : await lookup(host, { all: true });
  if (records.length === 0) {
    throw new Error(`Could not resolve "${host}"`);
  }
  for (const rec of records) {
    if (isPrivateIpAddress(rec.address)) {
      throw new Error(`Refusing host "${host}" resolving to private IP ${rec.address}`);
    }
  }
  const chosen = records[0];
  return {
    url: parsed,
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  };
}

function performPinnedRequest(
  endpoint: { url: URL; address: string; family: 4 | 6 },
  maxBytes: number,
  signal?: AbortSignal,
  opts?: PublicFetchOptions,
): Promise<{
  status: number;
  contentType: string;
  headers: Record<string, string>;
  location?: string;
  buffer: Buffer;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const override = opts?._testConnectOverride;
    const isHttps = override ? false : endpoint.url.protocol === 'https:';
    const reqFn = isHttps ? httpsRequest : httpRequest;
    const rawHost = endpoint.url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    const timeoutMs = opts?.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
    const method = opts?.method ?? 'GET';
    const bodyBuf =
      opts?.body !== undefined
        ? Buffer.isBuffer(opts.body)
          ? opts.body
          : Buffer.from(opts.body, 'utf8')
        : undefined;

    const headers: Record<string, string> = {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'text/html,application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...opts?.headers,
    };
    if (override && !headers.Host && !headers.host) {
      headers.Host = endpoint.url.host;
    }
    if (bodyBuf && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = String(bodyBuf.byteLength);
    }

    const req = override
      ? reqFn(
          {
            protocol: 'http:',
            hostname: override.host,
            port: override.port,
            path: `${endpoint.url.pathname}${endpoint.url.search}`,
            method,
            timeout: timeoutMs,
            headers,
          },
          onResponse,
        )
      : reqFn(
          endpoint.url,
          {
            method,
            timeout: timeoutMs,
            servername: isIP(rawHost) ? undefined : rawHost,
            headers,
            lookup: ((_hostname: string, lookupOpts: unknown, cb: (...args: unknown[]) => void) => {
              if (lookupOpts && typeof lookupOpts === 'object' && (lookupOpts as { all?: boolean }).all) {
                cb(null, [{ address: endpoint.address, family: endpoint.family }]);
              } else {
                cb(null, endpoint.address, endpoint.family);
              }
            }) as RequestOptions['lookup'],
          },
          onResponse,
        );

    function onResponse(res: any) {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers['content-type'] || '');
      const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
      const responseHeaders: Record<string, string> = {};
      for (const h of ['content-type', 'cache-control']) {
        const val = res.headers?.[h];
        if (typeof val === 'string' && val) {
          responseHeaders[h] = val;
        }
      }

      if (status >= 300 && status < 400 && location) {
        res.resume();
        settleResolve({ status, contentType, headers: responseHeaders, location, buffer: Buffer.alloc(0) });
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.byteLength;
        if (total > maxBytes) {
          req.destroy(new Error(`Response exceeded maximum size of ${maxBytes} bytes`));
          return;
        }
        chunks.push(buf);
      });
      res.on('end', () => {
        settleResolve({ status, contentType, headers: responseHeaders, buffer: Buffer.concat(chunks) });
      });
      res.on('error', settleReject);
    }

    let settled = false;
    const settleResolve = (val: {
      status: number;
      contentType: string;
      headers: Record<string, string>;
      location?: string;
      buffer: Buffer;
    }) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolvePromise(val);
    };
    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      rejectPromise(err);
    };
    const onAbort = () => {
      const reason = signal?.reason instanceof Error ? signal.reason : new Error('Aborted');
      req.destroy(reason);
      settleReject(reason);
    };

    req.on('timeout', () => {
      req.destroy(new Error(`HTTP request timed out after ${Math.round(timeoutMs / 1000)}s (${endpoint.url.hostname})`));
    });
    req.on('error', settleReject);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (bodyBuf) {
      req.write(bodyBuf);
    }
    req.end();
  });
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal, getAbortError: () => Error): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(getAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(getAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export async function fetchPublicUrlBounded(
  rawUrl: string,
  maxBytes: number = MAX_WEB_FETCH_BYTES,
  signal?: AbortSignal,
  fetchOpts: PublicFetchOptions = {},
): Promise<{
  finalUrl: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  buffer: Buffer;
}> {
  const maxRedirects = fetchOpts.maxRedirects ?? MAX_WEB_REDIRECTS;
  const totalTimeoutMs = fetchOpts.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const overallController = new AbortController();
  let timedOut = false;

  const getAbortError = () =>
    timedOut
      ? new Error(`HTTP request timed out after ${totalTimeoutMs}ms (${rawUrl})`)
      : signal?.reason instanceof Error
        ? signal.reason
        : new Error('Aborted');

  const timer = setTimeout(() => {
    timedOut = true;
    overallController.abort(new Error(`HTTP request timed out after ${totalTimeoutMs}ms (${rawUrl})`));
  }, totalTimeoutMs);

  const onCallerAbort = () => {
    overallController.abort(signal?.reason);
  };
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw getAbortError();
    }
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let currentUrl = rawUrl;
  let currentMethod: 'GET' | 'POST' = fetchOpts.method ?? 'GET';
  let currentBody: string | Buffer | undefined = fetchOpts.body;
  const currentHeaders: Record<string, string> | undefined = fetchOpts.headers
    ? { ...fetchOpts.headers }
    : undefined;

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const endpoint = await raceWithAbort(
        resolveValidatedPublicEndpoint(currentUrl, fetchOpts._testResolver),
        overallController.signal,
        getAbortError,
      );
      const result = await performPinnedRequest(endpoint, maxBytes, overallController.signal, {
        ...fetchOpts,
        timeoutMs: totalTimeoutMs,
        method: currentMethod,
        body: currentBody,
        headers: currentHeaders,
      });
      if (result.status >= 300 && result.status < 400 && result.location) {
        if (hop === maxRedirects) {
          throw new Error(`Exceeded maximum redirects (${maxRedirects}) fetching ${rawUrl}`);
        }
        const nextUrl = new URL(result.location, endpoint.url);
        if (nextUrl.origin !== endpoint.url.origin && currentHeaders) {
          for (const k of Object.keys(currentHeaders)) {
            const lower = k.toLowerCase();
            if (lower === 'authorization' || lower === 'x-subscription-token' || lower === 'cookie') {
              delete currentHeaders[k];
            }
          }
        }
        if (result.status === 301 || result.status === 302 || result.status === 303) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        currentUrl = nextUrl.toString();
        continue;
      }
      return {
        finalUrl: endpoint.url.toString(),
        status: result.status,
        contentType: result.contentType,
        headers: result.headers,
        buffer: result.buffer,
      };
    }

    throw new Error(`Failed to fetch ${rawUrl}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

export function normalizePublicWebUrl(rawHref: string, baseUrl?: string): string | null {
  const decoded = decodeHtmlEntities((rawHref || '').trim());
  if (!decoded || decoded.startsWith('#')) return null;
  if (/^(?:javascript|mailto|tel|data|blob|about|file):/i.test(decoded)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(decoded, baseUrl) : new URL(decoded);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (isBlockedHostname(host)) {
    return null;
  }
  if (isIP(host) && isPrivateIpAddress(host)) {
    return null;
  }
  if (parsed.hostname.endsWith('.')) {
    parsed.hostname = host;
  }
  parsed.hash = '';
  return parsed.toString();
}

export function unwrapDuckDuckGoUrl(rawHref: string): string | null {
  const decoded = decodeHtmlEntities((rawHref || '').trim());
  if (!decoded) return null;

  let candidate = decoded;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (candidate.startsWith('/')) {
    candidate = `https://duckduckgo.com${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const pathLower = parsed.pathname.toLowerCase();

  if (
    pathLower.includes('/y.js') ||
    parsed.searchParams.has('ad_domain') ||
    parsed.searchParams.has('ad_provider') ||
    parsed.searchParams.has('ad_type')
  ) {
    return null;
  }

  if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) {
    const uddg = parsed.searchParams.get('uddg');
    if (!uddg) return null;
    try {
      parsed = new URL(uddg);
    } catch {
      return null;
    }
    if (parsed.pathname.toLowerCase().includes('/y.js') || parsed.searchParams.has('ad_domain')) {
      return null;
    }
  }

  return normalizePublicWebUrl(parsed.toString());
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  captcha_blocked?: boolean;
  message?: string;
  results: WebSearchResultItem[];
}

export function isDuckDuckGoBotChallenge(status: number, html: string): boolean {
  const lower = (html || '').toLowerCase();
  if (lower.includes('anomaly-modal') || lower.includes('cc=botnet') || lower.includes('bots use duckduckgo too')) {
    return true;
  }
  if (status === 202 || status === 403 || status === 429) {
    if (
      /\b(?:anomaly|botnet|captcha|challenge|verify\s+you\s+are\s+human|unusual\s+traffic|automated)\b/i.test(html) ||
      status === 202 ||
      status === 403
    ) {
      return true;
    }
  }
  return false;
}

export function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const seenUrls = new Set<string>();
  const htmlAnchorRe = /<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(htmlAnchorRe));

  for (let i = 0; i < matches.length && results.length < maxResults; i += 1) {
    const m = matches[i];
    const startIdx = m.index ?? 0;
    const prevEndIdx = i > 0 ? (matches[i - 1].index ?? 0) + matches[i - 1][0].length : Math.max(0, startIdx - 600);
    const preContext = html.slice(Math.max(prevEndIdx, startIdx - 600), startIdx);
    if (/\b(?:result--ad|badge--ad)\b/i.test(preContext)) {
      continue;
    }

    const attrs = m[1] || '';
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;

    const cleanUrl = unwrapDuckDuckGoUrl(hrefMatch[1]);
    if (!cleanUrl || seenUrls.has(cleanUrl)) continue;

    const title = cleanInlineText(m[2] || '');
    if (!title) continue;

    const nextStartIdx = i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length;
    const afterSlice = html.slice(startIdx + m[0].length, Math.min(html.length, nextStartIdx));
    const snippetMatch = afterSlice.match(
      /<(?:a|div|span|td)\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i,
    );
    const snippet = snippetMatch?.[1] ? cleanInlineText(snippetMatch[1]) : '';

    seenUrls.add(cleanUrl);
    results.push({ title, url: cleanUrl, snippet });
  }

  return results;
}

export interface WebSearchOptions {
  maxResults?: number;
  braveApiKey?: string;
  signal?: AbortSignal;
  _testFetchOptions?: PublicFetchOptions;
  _testDdgHtmlBaseUrl?: string;
}

export async function performWebSearch(
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResponse> {
  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) {
    throw new Error('query is required');
  }

  const maxResults = Math.min(Math.max(Math.trunc(options.maxResults ?? 5), 1), 10);
  const baseFetchOpts = options._testFetchOptions ?? {};

  const braveKey = (options.braveApiKey ?? process.env.BRAVE_API_KEY ?? '').trim();
  if (braveKey && !options._testDdgHtmlBaseUrl) {
    try {
      const braveUrl = new URL('https://api.search.brave.com/res/v1/web/search');
      braveUrl.searchParams.set('q', trimmedQuery);
      braveUrl.searchParams.set('count', String(maxResults));
      const resp = await fetchPublicUrlBounded(braveUrl.toString(), MAX_WEB_FETCH_BYTES, options.signal, {
        ...baseFetchOpts,
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': braveKey,
          ...baseFetchOpts.headers,
        },
      });
      if (resp.status >= 200 && resp.status < 300) {
        const parsed = JSON.parse(resp.buffer.toString('utf8')) as {
          web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
        };
        const items: WebSearchResultItem[] = [];
        for (const r of parsed.web?.results ?? []) {
          const normUrl = r.url ? normalizePublicWebUrl(r.url) : null;
          if (!normUrl) continue;
          items.push({
            title: decodeHtmlEntities((r.title || normUrl).trim()),
            url: normUrl,
            snippet: cleanInlineText(r.description || ''),
          });
          if (items.length >= maxResults) break;
        }
        return { query: trimmedQuery, provider: 'brave', results: items };
      }
    } catch {
      // Fall back to DuckDuckGo HTML
    }
  }

  const ddgUrl = new URL(options._testDdgHtmlBaseUrl || 'https://html.duckduckgo.com/html/');
  ddgUrl.searchParams.set('q', trimmedQuery);
  ddgUrl.searchParams.set('kl', 'us-en');

  const resp = await fetchPublicUrlBounded(ddgUrl.toString(), MAX_WEB_FETCH_BYTES, options.signal, {
    ...baseFetchOpts,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...baseFetchOpts.headers,
    },
  });
  const html = resp.buffer.toString('utf8');

  if (isDuckDuckGoBotChallenge(resp.status, html)) {
    return {
      query: trimmedQuery,
      provider: 'duckduckgo_html',
      captcha_blocked: true,
      results: [],
      message: 'Search provider returned a bot challenge; rely on loaded rubric skill and cached criteria.',
    };
  }

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`DuckDuckGo search returned HTTP ${resp.status}`);
  }

  return {
    query: trimmedQuery,
    provider: 'duckduckgo_html',
    results: parseDuckDuckGoHtml(html, maxResults),
  };
}

export async function performWebFetch(
  url: string,
  options: { maxChars?: number; signal?: AbortSignal; _testFetchOptions?: PublicFetchOptions } = {},
): Promise<{ url: string; status: number; contentType: string; text: string }> {
  const maxChars = Math.min(Math.max(Math.trunc(options.maxChars ?? MAX_WEB_FETCH_CHARS), 500), MAX_WEB_FETCH_CHARS);
  const resp = await fetchPublicUrlBounded(url, MAX_WEB_FETCH_BYTES, options.signal, options._testFetchOptions ?? {});
  const rawText = resp.buffer.toString('utf8');
  const isHtml =
    /html|xhtml/i.test(resp.contentType) || /<!doctype\s+html|<html\b/i.test(rawText.slice(0, 512));

  const text = isHtml
    ? stripHtmlToText(rawText, maxChars)
    : rawText.slice(0, maxChars) + (rawText.length > maxChars ? '\n...[truncated]' : '');

  return {
    url: resp.finalUrl,
    status: resp.status,
    contentType: resp.contentType,
    text,
  };
}

const WebSearchParamsSchema = obj({
  query: str({ description: 'Search query for interview evaluation standards or role expectations.' }),
  max_results: opt(int({ description: 'Maximum results to return (1-10, default 5).', minimum: 1, maximum: 10 })),
});

const WebFetchParamsSchema = obj({
  url: str({ description: 'Public http/https URL to fetch and extract readable text from.' }),
});

export function createWebSearchTool(options: {
  braveApiKey?: string;
  recordToolCall?: (name: string) => void;
  _testFetchOptions?: PublicFetchOptions;
  _testDdgHtmlBaseUrl?: string;
} = {}): AgentTool<typeof WebSearchParamsSchema> {
  return {
    name: 'web_search',
    label: 'Search the web',
    description:
      'Search public web sources for current interview evaluation standards. Uses Brave Search API if configured, otherwise DuckDuckGo HTML. Never bypasses bot challenges.',
    parameters: WebSearchParamsSchema,
    execute: async (_id, params, signal): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        const res = await performWebSearch(String(params?.query ?? ''), {
          maxResults: typeof params?.max_results === 'number' ? params.max_results : 5,
          braveApiKey: options.braveApiKey,
          signal,
          _testFetchOptions: options._testFetchOptions,
          _testDdgHtmlBaseUrl: options._testDdgHtmlBaseUrl,
        });
        options.recordToolCall?.('web_search');
        return {
          content: [{ type: 'text', text: JSON.stringify(res) }],
          details: {},
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
          details: {},
          isError: true,
        };
      }
    },
  };
}

export function createWebFetchTool(options: {
  recordToolCall?: (name: string) => void;
  _testFetchOptions?: PublicFetchOptions;
} = {}): AgentTool<typeof WebFetchParamsSchema> {
  return {
    name: 'web_fetch',
    label: 'Fetch web page',
    description:
      'Fetch a public http/https webpage with strict SSRF protection (blocks private/loopback/metadata IPs, max 4 redirects, 2 MiB limit, 10s timeout) and extract up to 20,000 chars of clean text.',
    parameters: WebFetchParamsSchema,
    execute: async (_id, params, signal): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        const res = await performWebFetch(String(params?.url ?? ''), {
          signal,
          _testFetchOptions: options._testFetchOptions,
        });
        options.recordToolCall?.('web_fetch');
        return {
          content: [{ type: 'text', text: JSON.stringify(res) }],
          details: {},
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
          details: {},
          isError: true,
        };
      }
    },
  };
}
