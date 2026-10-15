import { money } from '../common/money';
import { matchPurchaseOrderToInvoice } from './three-way-match';

const d = (value: string) => money(value);

describe('three-way match', () => {
  it('matches when PO, invoice, project, supplier and cost codes agree', () => {
    const result = matchPurchaseOrderToInvoice({
      poAmount: d('1000'),
      invoiceAmount: d('1000'),
      poQuantity: d('10'),
      invoiceQuantity: d('10'),
      poProjectId: 'p1',
      invoiceProjectId: 'p1',
      poSupplierId: 's1',
      invoiceSupplierId: 's1',
      poCostCodeIds: ['c1'],
      invoiceCostCodeIds: ['c1'],
    });
    expect(result.matched).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('reports invoice exceeding PO', () => {
    const result = matchPurchaseOrderToInvoice({
      poAmount: d('1000'),
      invoiceAmount: d('11500'),
      poQuantity: d('10'),
      invoiceQuantity: d('10'),
      poProjectId: 'p1',
      invoiceProjectId: 'p1',
      poSupplierId: 's1',
      invoiceSupplierId: 's1',
      poCostCodeIds: ['c1'],
      invoiceCostCodeIds: ['c1'],
    });
    expect(result.matched).toBe(false);
    expect(result.issues[0]).toEqual({ type: 'INVOICE_EXCEEDS_PO', amount: '10500.00' });
    expect(result.summary).toContain('exceeds approved purchase order');
  });

  it('explains a cost code mismatch when amounts agree', () => {
    const result = matchPurchaseOrderToInvoice({
      poAmount: d('1200'),
      invoiceAmount: d('1200'),
      poQuantity: d('1'),
      invoiceQuantity: d('1'),
      poProjectId: 'p1',
      invoiceProjectId: 'p1',
      poSupplierId: 's1',
      invoiceSupplierId: 's1',
      poCostCodeIds: ['conc'],
      invoiceCostCodeIds: ['elec'],
      poCostCodeLabels: ['CONC'],
      invoiceCostCodeLabels: ['ELEC'],
      poDescriptions: ['Cement'],
      invoiceDescriptions: ['Electrical materials'],
    });
    expect(result.matched).toBe(false);
    expect(result.summary).toContain('Cost code differs from purchase order');
    expect(result.summary).toContain('Line items differ');
  });
});
