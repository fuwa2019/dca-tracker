export interface ApiLimitConfig {
  maxRequestsPerMinute: number;
  endpointMaxRequestsPerMinute: Partial<Record<ApiEndpoint, number>>;
  safetyMargin: number;
  maxSymbolsPerQuoteRequest: number;
  autoRefreshMinIntervalMs: number;
  hiddenRefreshMultiplier: number;
}

export type ApiEndpoint = 'quote' | 'chart' | 'history' | 'search';

export const DEFAULT_API_LIMIT_CONFIG: ApiLimitConfig = {
  maxRequestsPerMinute: 30,
  endpointMaxRequestsPerMinute: {
    quote: 30,
    chart: 20,
    history: 10,
    search: 20,
  },
  safetyMargin: 0.5,
  maxSymbolsPerQuoteRequest: 20,
  autoRefreshMinIntervalMs: 30_000,
  hiddenRefreshMultiplier: 4,
};

type QueueItem<T> = {
  endpoint: ApiEndpoint;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const lastRunAt = new Map<ApiEndpoint | 'global', number>();
const queues = new Map<ApiEndpoint, Array<QueueItem<unknown>>>();
const timers = new Map<ApiEndpoint, ReturnType<typeof setTimeout>>();

export function apiLimitConfigFromEnv(env: Record<string, string | undefined>): ApiLimitConfig {
  return {
    maxRequestsPerMinute: positiveNumber(env.VITE_QUOTE_API_MAX_REQUESTS_PER_MINUTE, DEFAULT_API_LIMIT_CONFIG.maxRequestsPerMinute),
    endpointMaxRequestsPerMinute: {
      quote: positiveNumber(env.VITE_QUOTE_API_QUOTE_MAX_REQUESTS_PER_MINUTE, DEFAULT_API_LIMIT_CONFIG.endpointMaxRequestsPerMinute.quote!),
      chart: positiveNumber(env.VITE_QUOTE_API_CHART_MAX_REQUESTS_PER_MINUTE, DEFAULT_API_LIMIT_CONFIG.endpointMaxRequestsPerMinute.chart!),
      history: positiveNumber(env.VITE_QUOTE_API_HISTORY_MAX_REQUESTS_PER_MINUTE, DEFAULT_API_LIMIT_CONFIG.endpointMaxRequestsPerMinute.history!),
      search: positiveNumber(env.VITE_QUOTE_API_SEARCH_MAX_REQUESTS_PER_MINUTE, DEFAULT_API_LIMIT_CONFIG.endpointMaxRequestsPerMinute.search!),
    },
    safetyMargin: clamp(
      positiveNumber(env.VITE_QUOTE_API_SAFETY_MARGIN, DEFAULT_API_LIMIT_CONFIG.safetyMargin),
      0.1,
      1,
    ),
    maxSymbolsPerQuoteRequest: Math.max(
      1,
      Math.floor(positiveNumber(env.VITE_QUOTE_API_MAX_SYMBOLS_PER_QUOTE, DEFAULT_API_LIMIT_CONFIG.maxSymbolsPerQuoteRequest)),
    ),
    autoRefreshMinIntervalMs: Math.max(
      5_000,
      positiveNumber(env.VITE_QUOTE_API_AUTO_REFRESH_MIN_MS, DEFAULT_API_LIMIT_CONFIG.autoRefreshMinIntervalMs),
    ),
    hiddenRefreshMultiplier: Math.max(
      1,
      positiveNumber(env.VITE_QUOTE_API_HIDDEN_REFRESH_MULTIPLIER, DEFAULT_API_LIMIT_CONFIG.hiddenRefreshMultiplier),
    ),
  };
}

export function calculateRefreshInterval(
  symbolCount: number,
  config: ApiLimitConfig = DEFAULT_API_LIMIT_CONFIG,
): number {
  const count = Math.max(0, Math.floor(symbolCount));
  if (count === 0) return config.autoRefreshMinIntervalMs;
  const batchSize = Math.max(1, Math.floor(config.maxSymbolsPerQuoteRequest));
  const requestsPerRefresh = Math.max(1, Math.ceil(count / batchSize));
  const quoteLimit = config.endpointMaxRequestsPerMinute.quote ?? config.maxRequestsPerMinute;
  const safeLimit = Math.max(1, Math.floor(Math.min(config.maxRequestsPerMinute, quoteLimit) * config.safetyMargin));
  const limitInterval = Math.ceil((requestsPerRefresh / safeLimit) * 60_000);
  return Math.max(config.autoRefreshMinIntervalMs, limitInterval);
}

export function splitIntoBatches<T>(values: T[], maxBatchSize: number): T[][] {
  const size = Math.max(1, Math.floor(maxBatchSize));
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export function rateLimited<T>(
  endpoint: ApiEndpoint,
  run: () => Promise<T>,
  config: ApiLimitConfig = DEFAULT_API_LIMIT_CONFIG,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const queue = queues.get(endpoint) ?? [];
    queue.push({ endpoint, run, resolve, reject } as QueueItem<unknown>);
    queues.set(endpoint, queue);
    schedule(endpoint, config);
  });
}

export function resetRateLimiterForTests() {
  queues.clear();
  lastRunAt.clear();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

function schedule(endpoint: ApiEndpoint, config: ApiLimitConfig) {
  if (timers.has(endpoint)) return;
  const delay = nextDelay(endpoint, config);
  timers.set(endpoint, setTimeout(() => drain(endpoint, config), delay));
}

async function drain(endpoint: ApiEndpoint, config: ApiLimitConfig) {
  timers.delete(endpoint);
  const queue = queues.get(endpoint);
  const item = queue?.shift();
  if (!item) return;
  if ((queue?.length ?? 0) === 0) queues.delete(endpoint);
  const now = Date.now();
  lastRunAt.set('global', now);
  lastRunAt.set(endpoint, now);
  try {
    item.resolve(await item.run());
  } catch (error) {
    item.reject(error);
  } finally {
    if ((queues.get(endpoint)?.length ?? 0) > 0) schedule(endpoint, config);
  }
}

function nextDelay(endpoint: ApiEndpoint, config: ApiLimitConfig): number {
  const now = Date.now();
  const globalLimit = Math.max(1, Math.floor(config.maxRequestsPerMinute * config.safetyMargin));
  const endpointLimit = Math.max(
    1,
    Math.floor((config.endpointMaxRequestsPerMinute[endpoint] ?? config.maxRequestsPerMinute) * config.safetyMargin),
  );
  const globalMs = 60_000 / globalLimit;
  const endpointMs = 60_000 / endpointLimit;
  const globalWait = Math.max(0, (lastRunAt.get('global') ?? 0) + globalMs - now);
  const endpointWait = Math.max(0, (lastRunAt.get(endpoint) ?? 0) + endpointMs - now);
  return Math.ceil(Math.max(globalWait, endpointWait));
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
