export type DeferredInvoiceInput = {
  invoiceId: string;
  orderId: string;
  buyerName: string;
  buyerTaxCode: string;
  buyerAddress: string;
  buyerEmail: string;
  totalAmount: number;
};

export type InvoiceProviderResult = {
  status: "deferred";
  provider: "noop";
  payload: Record<string, unknown>;
};

export interface InvoiceProvider {
  issue(input: DeferredInvoiceInput): Promise<InvoiceProviderResult>;
}

/**
 * Q6: chưa có tài khoản Viettel/VNPT/MISA nên tuyệt đối không phát hành giả.
 * Provider này chỉ ghi dấu vết đủ để phát hành bù sau khi nhà cung cấp được nối.
 */
export class NoopInvoiceProvider implements InvoiceProvider {
  async issue(input: DeferredInvoiceInput): Promise<InvoiceProviderResult> {
    return {
      status: "deferred",
      provider: "noop",
      payload: {
        deferred: true,
        reason: "invoice_provider_not_configured",
        orderId: input.orderId,
        queuedAt: new Date().toISOString(),
      },
    };
  }
}

export const invoiceProvider: InvoiceProvider = new NoopInvoiceProvider();
