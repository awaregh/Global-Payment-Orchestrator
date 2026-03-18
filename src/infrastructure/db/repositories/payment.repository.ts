import type { PoolClient } from 'pg';
import { pool } from '../postgres';
import type { PaymentRepository, TransactionRepository } from '../../../domain/interfaces/payment-repository';
import type { Payment, Transaction, CreatePaymentInput } from '../../../domain/types';

type PaymentRow = {
  id: string;
  idempotency_key: string;
  merchant_id: string;
  customer_id: string;
  amount: string;
  currency: string;
  region: string;
  status: string;
  provider_id: string | null;
  provider_transaction_id: string | null;
  metadata: Record<string, string>;
  created_at: Date;
  updated_at: Date;
};

type TransactionRow = {
  id: string;
  payment_id: string;
  provider_id: string;
  provider_transaction_id: string;
  type: string;
  amount: string;
  currency: string;
  status: string;
  latency_ms: string;
  error_code: string | null;
  created_at: Date;
};

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    merchantId: row.merchant_id,
    customerId: row.customer_id,
    amount: parseInt(row.amount, 10),
    currency: row.currency as Payment['currency'],
    region: row.region as Payment['region'],
    status: row.status as Payment['status'],
    providerId: row.provider_id as Payment['providerId'],
    providerTransactionId: row.provider_transaction_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    paymentId: row.payment_id,
    providerId: row.provider_id as Transaction['providerId'],
    providerTransactionId: row.provider_transaction_id,
    type: row.type as Transaction['type'],
    amount: parseInt(row.amount, 10),
    currency: row.currency as Transaction['currency'],
    status: row.status as Transaction['status'],
    latencyMs: parseInt(row.latency_ms, 10),
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

export class PostgresPaymentRepository implements PaymentRepository {
  private readonly db: typeof pool;

  constructor(db: typeof pool = pool) {
    this.db = db;
  }

  async create(input: CreatePaymentInput & { id: string }, client?: PoolClient): Promise<Payment> {
    const exec = client ?? this.db;
    const result = await exec.query<PaymentRow>(
      `INSERT INTO payments
        (id, idempotency_key, merchant_id, customer_id, amount, currency, region, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING *`,
      [
        input.id,
        input.idempotencyKey,
        input.merchantId,
        input.customerId,
        input.amount,
        input.currency,
        input.region,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create payment');
    return toPayment(row);
  }

  async findById(id: string): Promise<Payment | null> {
    const result = await this.db.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? toPayment(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const result = await this.db.query<PaymentRow>(
      'SELECT * FROM payments WHERE idempotency_key = $1',
      [key],
    );
    const row = result.rows[0];
    return row ? toPayment(row) : null;
  }

  async updateStatus(
    id: string,
    status: Payment['status'],
    updates?: Partial<Pick<Payment, 'providerId' | 'providerTransactionId'>>,
  ): Promise<Payment> {
    const result = await this.db.query<PaymentRow>(
      `UPDATE payments
       SET status = $2,
           provider_id = COALESCE($3, provider_id),
           provider_transaction_id = COALESCE($4, provider_transaction_id),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, updates?.providerId ?? null, updates?.providerTransactionId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Payment ${id} not found during update`);
    return toPayment(row);
  }
}

export class PostgresTransactionRepository implements TransactionRepository {
  private readonly db: typeof pool;

  constructor(db: typeof pool = pool) {
    this.db = db;
  }

  async create(transaction: Omit<Transaction, 'createdAt'>): Promise<Transaction> {
    const result = await this.db.query<TransactionRow>(
      `INSERT INTO transactions
        (id, payment_id, provider_id, provider_transaction_id, type, amount, currency, status, latency_ms, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        transaction.id,
        transaction.paymentId,
        transaction.providerId,
        transaction.providerTransactionId,
        transaction.type,
        transaction.amount,
        transaction.currency,
        transaction.status,
        transaction.latencyMs,
        transaction.errorCode ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create transaction');
    return toTransaction(row);
  }

  async findByPaymentId(paymentId: string): Promise<Transaction[]> {
    const result = await this.db.query<TransactionRow>(
      'SELECT * FROM transactions WHERE payment_id = $1 ORDER BY created_at ASC',
      [paymentId],
    );
    return result.rows.map(toTransaction);
  }
}
