# Global Payment Orchestrator

A production-grade global payment routing system built in Node.js + TypeScript. Routes payments across multiple providers (Stripe, PayPal, Crypto) based on cost, latency, reliability, and geography — similar to the routing layer used by Stripe and Adyen.

---

## Table of Contents

- [Architecture](#architecture)
- [Folder Structure](#folder-structure)
- [Key Interfaces](#key-interfaces)
- [API Reference](#api-reference)
- [Routing Engine](#routing-engine)
- [Circuit Breaker](#circuit-breaker)
- [Event System](#event-system)
- [Database Schema](#database-schema)
- [Observability](#observability)
- [Getting Started](#getting-started)
- [Tradeoffs](#tradeoffs)
- [Scaling Strategy](#scaling-strategy)

---

## Architecture

The system follows clean architecture with strict layer separation:

```
┌─────────────────────────────────────┐
│              REST API               │  Express + Zod validation
├─────────────────────────────────────┤
│         Application Layer           │  PaymentService, RoutingService
├─────────────────────────────────────┤
│           Domain Layer              │  Types, Interfaces, Errors
├─────────────────────────────────────┤
│       Infrastructure Layer          │  PostgreSQL, Redis, Providers
└─────────────────────────────────────┘
```

**Key design decisions:**

- **Idempotency first.** Every payment write is guarded by a Redis distributed lock + persisted response cache. Duplicate requests within 24h return the original response without re-charging.
- **Routing by weighted score.** Providers are scored across success rate (50%), latency (30%), and cost (20%). Weights are configurable via environment variables.
- **Circuit breaker per provider.** Each provider has an independent circuit breaker. A tripping circuit automatically routes to the next-best provider.
- **Retry with fallback.** On charge failure, the system retries on a different provider (up to `ROUTING_MAX_RETRIES`), not the same one.
- **Redis Streams for events.** Durable, ordered event delivery with consumer groups. Analytics consumers track per-provider metrics used by the scoring engine — forming a real-time feedback loop.
- **Strong consistency for writes.** Payment status transitions are always written to PostgreSQL before the response is sent. Redis cache is write-invalidated on update.

---

## Folder Structure

```
src/
├── domain/                        # Pure business logic — no framework dependencies
│   ├── types/index.ts             # Payment, Transaction, Currency, Region, etc.
│   ├── errors/index.ts            # Typed error hierarchy (AppError, ValidationError…)
│   └── interfaces/
│       ├── payment-provider.ts    # PaymentProvider interface
│       └── payment-repository.ts  # PaymentRepository, TransactionRepository
│
├── application/                   # Orchestrates domain + infrastructure
│   └── services/
│       ├── payment.service.ts     # createPayment, getPayment, createRefund
│       └── routing.service.ts     # selectProvider, scoring, fallback
│
├── infrastructure/                # All I/O and external concerns
│   ├── db/
│   │   ├── postgres.ts            # pg Pool + withTransaction helper
│   │   ├── schema.sql             # DDL — payments, transactions, idempotency_keys
│   │   ├── migrate.ts             # One-shot migration runner
│   │   └── repositories/
│   │       └── payment.repository.ts  # PostgresPaymentRepository, PostgresTransactionRepository
│   ├── redis/
│   │   ├── client.ts              # ioredis singleton
│   │   └── idempotency.ts         # Lock + response cache + payment cache
│   ├── providers/
│   │   ├── stripe.provider.ts     # Stripe mock (3% fail rate, 50-150ms)
│   │   ├── paypal.provider.ts     # PayPal mock (5% fail rate, 100-300ms)
│   │   └── crypto.provider.ts     # Crypto mock (8% fail rate, 200-800ms)
│   ├── circuit-breaker/
│   │   └── index.ts               # Three-state circuit breaker (closed/open/half-open)
│   ├── events/
│   │   ├── publisher.ts           # Redis Streams XADD publisher
│   │   └── consumers/
│   │       └── analytics.consumer.ts  # XREADGROUP consumer — updates metrics
│   └── observability/
│       ├── logger.ts              # pino structured logger
│       └── metrics.ts             # In-process metrics registry (success rate, latency)
│
├── api/
│   ├── routes/
│   │   ├── payments.ts            # POST /payments, GET /payments/:id
│   │   └── refunds.ts             # POST /refunds
│   ├── middleware/
│   │   ├── validation.ts          # Zod schemas for all request bodies
│   │   └── error-handler.ts       # Centralized error → HTTP response mapping
│   └── server.ts                  # Express app factory
│
├── config/index.ts                # All config from env vars with typed defaults
└── index.ts                       # Entrypoint — dependency wiring + graceful shutdown
```

---

## Key Interfaces

```typescript
interface PaymentProvider {
  readonly id: ProviderId;
  readonly supportedCurrencies: ReadonlyArray<string>;
  readonly supportedRegions: ReadonlyArray<string>;
  charge(request: ChargeRequest): Promise<ProviderResult>;
  refund(request: RefundRequest): Promise<ProviderResult>;
  healthCheck(): Promise<boolean>;
}

interface Payment {
  id: string;
  idempotencyKey: string;
  merchantId: string;
  customerId: string;
  amount: number;           // always in minor units (cents, satoshis)
  currency: Currency;
  region: Region;
  status: PaymentStatus;
  providerId: ProviderId | null;
  providerTransactionId: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';
type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'BTC' | 'ETH';
type Region = 'us-east' | 'us-west' | 'eu-west' | 'eu-central' | 'ap-southeast' | 'ap-northeast';
type ProviderId = 'stripe' | 'paypal' | 'crypto';
```

---

## API Reference

### POST /payments

Creates a new payment. Idempotent via `idempotencyKey`.

**Request:**
```json
{
  "idempotencyKey": "order_abc123_attempt_1",
  "merchantId": "merchant_acme",
  "customerId": "cust_xyz",
  "amount": 4999,
  "currency": "USD",
  "region": "us-east",
  "metadata": {
    "orderId": "order_abc123"
  }
}
```

**Response (201):**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "idempotencyKey": "order_abc123_attempt_1",
    "merchantId": "merchant_acme",
    "customerId": "cust_xyz",
    "amount": 4999,
    "currency": "USD",
    "region": "us-east",
    "status": "succeeded",
    "providerId": "stripe",
    "providerTransactionId": "ch_3Nk...",
    "metadata": { "orderId": "order_abc123" },
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-01-15T10:00:00.123Z"
  }
}
```

**Error Response (422):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "amount", "message": "Number must be greater than 0" }]
  }
}
```

### GET /payments/:id

Retrieves a payment by UUID. Uses Redis cache with 60s TTL.

**Response (200):** Same shape as POST /payments response.

**Error (404):**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Payment with id 'abc' not found"
  }
}
```

### POST /refunds

Initiates a refund on a succeeded payment. Supports partial refunds.

**Request:**
```json
{
  "paymentId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 4999,
  "reason": "customer_request"
}
```

**Response (200):** Updated payment object with status `refunded` or `partially_refunded`.

### GET /health

Returns `{ "status": "ok", "timestamp": "..." }`.

### GET /metrics

Returns per-provider success rates, latencies, and system-level p50/p99 latency histogram.

---

## Routing Engine

Providers are selected by computing a weighted score per candidate:

```
score = successRate × 0.5 + normalizedLatency × 0.3 + normalizedCost × 0.2
```

Where:
- `successRate` is a rolling EMA from the analytics consumer (default 1.0 for cold-start)
- `normalizedLatency = max(0, 1 - avgLatencyMs / 2000)`
- `normalizedCost = 1 - (providerBaseCostRate / 0.05)`

Provider base costs: Stripe 2.9%, PayPal 3.4%, Crypto 1.0%.

Candidates are filtered by `supportedCurrencies` and `supportedRegions` before scoring, and any provider with an open circuit breaker is excluded. The highest-scoring available provider wins.

**Retry logic:** On failure, the system selects the next-best provider excluding already-tried ones, waits `ROUTING_RETRY_DELAY_MS × attempt` ms, and retries up to `ROUTING_MAX_RETRIES` times.

---

## Circuit Breaker

Three states per provider: **closed → open → half-open → closed**.

| State | Behavior |
|-------|----------|
| `closed` | Normal operation. Failure count increments on each error. |
| `open` | All requests rejected instantly. Re-evaluates after `CB_OPEN_TIMEOUT_MS`. |
| `half-open` | Allows `CB_HALF_OPEN_REQUESTS` probe requests. Closes on `CB_SUCCESS_THRESHOLD` consecutive successes. Re-opens on any failure. |

Defaults: 5 failures to open, 30s timeout, 2 successes to close.

---

## Event System

Events are published to a Redis Stream (`gpo:events`) via `XADD` with `MAXLEN ~` to cap stream size.

Emitted events:
- `payment.created` — immediately after DB insert
- `payment.succeeded` — after successful provider charge
- `payment.failed` — after all retry attempts exhausted

The `AnalyticsConsumer` reads via `XREADGROUP` (consumer group `gpo-consumers`), acknowledges processed messages, and updates the in-process metrics registry. This creates a real-time feedback loop: provider success rates computed from events directly influence routing scores.

**Tradeoff:** In-process metrics are per-instance. In a multi-node deployment, metrics should be stored in Redis or Prometheus to share state across instances.

---

## Database Schema

```sql
payments (
  id UUID PRIMARY KEY,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  merchant_id VARCHAR(255) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL,
  region VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  provider_id VARCHAR(50),
  provider_transaction_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

transactions (
  id UUID PRIMARY KEY,
  payment_id UUID REFERENCES payments(id),
  provider_id VARCHAR(50) NOT NULL,
  provider_transaction_id VARCHAR(255) NOT NULL,
  type VARCHAR(20) CHECK (type IN ('charge', 'refund')),
  amount BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) CHECK (status IN ('succeeded', 'failed')),
  latency_ms INT NOT NULL,
  error_code VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  payment_id UUID REFERENCES payments(id),
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

Amount is stored as an integer in minor currency units (cents for USD, satoshis for BTC) to avoid floating-point representation issues.

---

## Observability

**Structured logging (pino):**
Every request, routing decision, provider call, and event is logged with correlation fields (`paymentId`, `merchantId`, `provider`, `latencyMs`). In production (`LOG_PRETTY=false`), output is newline-delimited JSON suitable for ingestion by Datadog, Splunk, or CloudWatch.

**Metrics:**
The `MetricsRegistry` tracks per-provider success counts, failure counts, and cumulative latency. It also maintains a rolling latency histogram for p50/p99 computation. Exposed at `GET /metrics`.

**Request tracing:**
Each request receives an `x-request-id` header (caller-supplied or auto-generated). This ID is threaded through all log lines for the lifetime of a request.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- Docker + Docker Compose

### With Docker Compose

```bash
cp .env.example .env
docker compose up
```

PostgreSQL and Redis start first. The app container runs migrations and starts listening on port 3000.

### Without Docker (local dev)

```bash
cp .env.example .env
# Edit .env with your local DB/Redis credentials

npm install
npm run migrate       # applies schema.sql to your DB
npm run dev           # ts-node-dev with hot reload
```

### Build and run production

```bash
npm run build
node dist/index.js
```

### Run tests

```bash
npm test
npm run test:coverage
```

### Load test

With the server running:

```bash
node scripts/load-test.js --url http://localhost:3000 --rps 100 --duration 30
```

---

## Tradeoffs

### In-process metrics vs. external store

The metrics registry is in-process. In a multi-instance deployment, each node tracks its own provider stats. The routing engine on node A won't know about failures recorded on node B.

**Fix for production:** Flush per-provider counters to Redis sorted sets or a time-series database (Prometheus/VictoriaMetrics) and read aggregate stats during scoring.

### Redis Streams vs. Kafka

Redis Streams provides ordered, durable, at-least-once delivery with consumer groups — sufficient for most payment systems at <100k events/s. Kafka is better for multi-datacenter replication, replay from arbitrary offsets at high fanout, and >1M messages/s.

**Decision:** Redis Streams was chosen to minimize operational complexity. Switching to Kafka requires only changing the `EventPublisher` and consumer implementations.

### Idempotency via Redis lock vs. DB unique constraint

Both are needed. The DB `UNIQUE` constraint on `idempotency_key` is the safety net that prevents double inserts even if the Redis lock expires or a node crashes. The Redis lock prevents concurrent in-flight requests from both entering the critical section and racing to insert.

### Single-region architecture

This implementation stores all state in a single PostgreSQL cluster. Geographic distribution requires read replicas per region plus a write-ahead log strategy or a globally distributed DB (CockroachDB, PlanetScale, Spanner).

### Amount in minor units

All amounts are stored as `BIGINT` in minor currency units (cents, pence, satoshis). This avoids floating-point rounding — critical for financial systems. Client SDKs should enforce this convention.

---

## Scaling Strategy

### Horizontal API scaling (10k TPS)

- Run N stateless API instances behind a load balancer (ALB / nginx)
- Connection pooling via PgBouncer in front of PostgreSQL
- Redis Cluster for the idempotency store

### Database scaling

| Stage | Strategy |
|-------|----------|
| <1k TPS | Single Postgres primary + read replica |
| 1k–10k TPS | PgBouncer pooling + query optimization + partitioning payments by `created_at` |
| >10k TPS | Shard by `merchant_id` hash; use CockroachDB or Vitess |

### Provider timeout budget

Budget 2s end-to-end per request:
- 50ms: routing decision
- 1500ms: provider call (p99)
- 100ms: DB writes
- 350ms: buffer

### Cache-aside pattern

`GET /payments/:id` checks Redis first (60s TTL). Cache is invalidated on any status update. This offloads 80%+ of read traffic from PostgreSQL.

### Scaling the event system

Redis Streams consumer groups scale horizontally — add consumer instances, each takes a partition of messages. At very high volume, migrate to Kafka with partition-key = `merchant_id` for ordered processing per merchant.

### Feature flags for routing

The routing weights (`ROUTING_LATENCY_WEIGHT`, etc.) are already env-configurable. For dynamic feature flags, integrate LaunchDarkly or a custom Redis-backed flag store. The `RoutingService.selectProvider()` signature accepts a `RoutingContext` that can be extended with merchant-level override rules.
