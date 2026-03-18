import type { Payment, Transaction, CreatePaymentInput } from '../types';

export interface PaymentRepository {
  create(input: CreatePaymentInput & { id: string }): Promise<Payment>;
  findById(id: string): Promise<Payment | null>;
  findByIdempotencyKey(key: string): Promise<Payment | null>;
  updateStatus(
    id: string,
    status: Payment['status'],
    updates?: Partial<Pick<Payment, 'providerId' | 'providerTransactionId'>>,
  ): Promise<Payment>;
}

export interface TransactionRepository {
  create(transaction: Omit<Transaction, 'createdAt'>): Promise<Transaction>;
  findByPaymentId(paymentId: string): Promise<Transaction[]>;
}
