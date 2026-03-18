export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'BTC' | 'ETH';

export type Region = 'us-east' | 'us-west' | 'eu-west' | 'eu-central' | 'ap-southeast' | 'ap-northeast';

export type ProviderId = 'stripe' | 'paypal' | 'crypto';

export interface Money {
  amount: number;
  currency: Currency;
}

export interface Payment {
  id: string;
  idempotencyKey: string;
  merchantId: string;
  customerId: string;
  amount: number;
  currency: Currency;
  region: Region;
  status: PaymentStatus;
  providerId: ProviderId | null;
  providerTransactionId: string | null;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  paymentId: string;
  providerId: ProviderId;
  providerTransactionId: string;
  type: 'charge' | 'refund';
  amount: number;
  currency: Currency;
  status: 'succeeded' | 'failed';
  latencyMs: number;
  errorCode: string | null;
  createdAt: Date;
}

export interface IdempotencyRecord {
  key: string;
  paymentId: string;
  responseBody: unknown;
  createdAt: Date;
}

export interface ProviderStats {
  providerId: ProviderId;
  successRate: number;
  avgLatencyMs: number;
  windowSamples: number;
}

export interface RoutingContext {
  currency: Currency;
  region: Region;
  amount: number;
  merchantId: string;
}

export interface ChargeRequest {
  paymentId: string;
  amount: number;
  currency: Currency;
  customerId: string;
  metadata: Record<string, string>;
}

export interface RefundRequest {
  paymentId: string;
  providerTransactionId: string;
  amount: number;
  currency: Currency;
  reason?: string;
}

export interface ProviderResult {
  success: boolean;
  providerTransactionId: string;
  rawResponse: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface CreatePaymentInput {
  idempotencyKey: string;
  merchantId: string;
  customerId: string;
  amount: number;
  currency: Currency;
  region: Region;
  metadata?: Record<string, string>;
}

export interface CreateRefundInput {
  paymentId: string;
  amount: number;
  reason?: string;
}

export interface PaymentEvent {
  eventType: 'payment.created' | 'payment.succeeded' | 'payment.failed';
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: Currency;
  providerId: ProviderId | null;
  timestamp: string;
  metadata?: Record<string, string>;
}
