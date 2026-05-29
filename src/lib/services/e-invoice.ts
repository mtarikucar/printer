// Pluggable e-Arşiv / e-Fatura issuer. The default is a no-op stub that returns
// a synthetic reference. To go live, implement EInvoiceProvider with a real
// GİB / integrator (e.g. Foriba, Mikro, Paraşüt) client and assign it to
// `eInvoiceProvider` — no caller changes needed.

export interface EInvoiceInput {
  invoiceNumber: string;
  totalKurus: number;
  subtotalKurus: number;
  kdvKurus: number;
  customerName: string;
  customerEmail: string;
}

export interface EInvoiceProvider {
  issue(input: EInvoiceInput): Promise<{ providerRef: string }>;
}

const stubProvider: EInvoiceProvider = {
  async issue(input) {
    // No external call — synthetic reference so the rest of the flow works.
    console.log(
      `[e-invoice stub] would issue ${input.invoiceNumber} for ${input.totalKurus} kuruş`
    );
    return { providerRef: `STUB-${input.invoiceNumber}` };
  },
};

export const eInvoiceProvider: EInvoiceProvider = stubProvider;
