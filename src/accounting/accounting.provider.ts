export type AccountingCost = {
  externalId: string;
  amount: string;
  date: string;
  reference?: string;
};

export interface AccountingProvider {
  importSuppliers(): Promise<{ name: string; externalId: string }[]>;
  importInvoices(): Promise<{ externalId: string; amount: string }[]>;
  importPayments(): Promise<{ externalId: string; amount: string }[]>;
  importCosts(): Promise<AccountingCost[]>;
}

export class NullAccountingProvider implements AccountingProvider {
  async importSuppliers() {
    return [];
  }
  async importInvoices() {
    return [];
  }
  async importPayments() {
    return [];
  }
  async importCosts() {
    return [];
  }
}
