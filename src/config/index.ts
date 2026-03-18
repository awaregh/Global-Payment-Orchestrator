import dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: parseInt(optional('DB_PORT', '5432'), 10),
    database: optional('DB_NAME', 'payments'),
    user: optional('DB_USER', 'postgres'),
    password: optional('DB_PASSWORD', 'postgres'),
    poolMax: parseInt(optional('DB_POOL_MAX', '20'), 10),
    idleTimeoutMs: parseInt(optional('DB_IDLE_TIMEOUT_MS', '10000'), 10),
    connectionTimeoutMs: parseInt(optional('DB_CONNECTION_TIMEOUT_MS', '5000'), 10),
  },

  redis: {
    host: optional('REDIS_HOST', 'localhost'),
    port: parseInt(optional('REDIS_PORT', '6379'), 10),
    password: process.env['REDIS_PASSWORD'],
    db: parseInt(optional('REDIS_DB', '0'), 10),
    keyPrefix: optional('REDIS_KEY_PREFIX', 'gpo:'),
  },

  idempotency: {
    lockTtlSeconds: parseInt(optional('IDEMPOTENCY_LOCK_TTL_SECONDS', '30'), 10),
    recordTtlSeconds: parseInt(optional('IDEMPOTENCY_RECORD_TTL_SECONDS', '86400'), 10),
  },

  routing: {
    latencyWeight: parseFloat(optional('ROUTING_LATENCY_WEIGHT', '0.3')),
    successRateWeight: parseFloat(optional('ROUTING_SUCCESS_RATE_WEIGHT', '0.5')),
    costWeight: parseFloat(optional('ROUTING_COST_WEIGHT', '0.2')),
    maxRetries: parseInt(optional('ROUTING_MAX_RETRIES', '2'), 10),
    retryDelayMs: parseInt(optional('ROUTING_RETRY_DELAY_MS', '200'), 10),
  },

  circuitBreaker: {
    failureThreshold: parseInt(optional('CB_FAILURE_THRESHOLD', '5'), 10),
    successThreshold: parseInt(optional('CB_SUCCESS_THRESHOLD', '2'), 10),
    openTimeoutMs: parseInt(optional('CB_OPEN_TIMEOUT_MS', '30000'), 10),
    halfOpenRequests: parseInt(optional('CB_HALF_OPEN_REQUESTS', '3'), 10),
  },

  events: {
    streamKey: optional('EVENTS_STREAM_KEY', 'gpo:events'),
    consumerGroup: optional('EVENTS_CONSUMER_GROUP', 'gpo-consumers'),
    maxStreamLength: parseInt(optional('EVENTS_MAX_STREAM_LENGTH', '100000'), 10),
  },

  log: {
    level: optional('LOG_LEVEL', 'info'),
    pretty: optional('LOG_PRETTY', 'false') === 'true',
  },
} as const;

export function validateConfig(): void {
  if (config.env === 'production') {
    required('DB_PASSWORD');
    required('REDIS_PASSWORD');
  }
}
