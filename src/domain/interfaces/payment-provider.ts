import type { ChargeRequest, RefundRequest, ProviderResult, ProviderId } from '../types';

export interface PaymentProvider {
  readonly id: ProviderId;
  readonly supportedCurrencies: ReadonlyArray<string>;
  readonly supportedRegions: ReadonlyArray<string>;

  charge(request: ChargeRequest): Promise<ProviderResult>;
  refund(request: RefundRequest): Promise<ProviderResult>;
  healthCheck(): Promise<boolean>;
}
