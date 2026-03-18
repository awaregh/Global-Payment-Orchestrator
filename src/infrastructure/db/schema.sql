-- Global Payment Orchestrator Schema
-- Run once during initial setup

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  merchant_id VARCHAR(255) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL,
  region VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  provider_id VARCHAR(50),
  provider_transaction_id VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_idempotency_key ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_merchant_id ON payments(merchant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  provider_id VARCHAR(50) NOT NULL,
  provider_transaction_id VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('charge', 'refund')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('succeeded', 'failed')),
  latency_ms INT NOT NULL,
  error_code VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_payment_id ON transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_transactions_provider_id ON transactions(provider_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payments(id),
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
