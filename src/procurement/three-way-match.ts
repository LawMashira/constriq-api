import { Prisma } from '@prisma/client';
import { money } from '../common/money';

export type MatchIssue = { type: string; amount?: string; detail?: string };

export type MatchCheck = {
  key: string;
  label: string;
  po: string;
  invoice: string;
  ok: boolean;
  reason?: string;
};

export type MatchResult = {
  matched: boolean;
  issues: MatchIssue[];
  checks: MatchCheck[];
  summary: string;
};

function labels(values: string[]): string {
  return values.filter(Boolean).join(', ') || '—';
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchPurchaseOrderToInvoice(input: {
  poAmount: Prisma.Decimal;
  invoiceAmount: Prisma.Decimal;
  poQuantity: Prisma.Decimal;
  invoiceQuantity: Prisma.Decimal;
  poProjectId: string;
  invoiceProjectId: string;
  poSupplierId: string;
  invoiceSupplierId: string;
  poCostCodeIds: string[];
  invoiceCostCodeIds: string[];
  poSupplierName?: string;
  invoiceSupplierName?: string;
  poCostCodeLabels?: string[];
  invoiceCostCodeLabels?: string[];
  poDescriptions?: string[];
  invoiceDescriptions?: string[];
}): MatchResult {
  const issues: MatchIssue[] = [];
  const checks: MatchCheck[] = [];
  const poAmount = money(input.poAmount).toFixed(2);
  const invoiceAmount = money(input.invoiceAmount).toFixed(2);
  const amountOk = !money(input.invoiceAmount).gt(input.poAmount);
  if (!amountOk) {
    const over = money(input.invoiceAmount).minus(input.poAmount).toFixed(2);
    issues.push({ type: 'INVOICE_EXCEEDS_PO', amount: over });
    checks.push({
      key: 'amount',
      label: 'Amount',
      po: poAmount,
      invoice: invoiceAmount,
      ok: false,
      reason: `Supplier invoice exceeds approved purchase order by ${over}.`,
    });
  } else {
    checks.push({ key: 'amount', label: 'Amount', po: poAmount, invoice: invoiceAmount, ok: true });
  }

  const qtyOk = !input.invoiceQuantity.gt(input.poQuantity);
  if (!qtyOk) {
    const over = input.invoiceQuantity.minus(input.poQuantity).toFixed(4);
    issues.push({ type: 'QUANTITY_GREATER_THAN_ORDERED', amount: over });
    checks.push({
      key: 'quantity',
      label: 'Quantity',
      po: input.poQuantity.toFixed(4),
      invoice: input.invoiceQuantity.toFixed(4),
      ok: false,
      reason: `Invoice quantity exceeds the purchase order by ${over}.`,
    });
  } else {
    checks.push({
      key: 'quantity',
      label: 'Quantity',
      po: input.poQuantity.toFixed(4),
      invoice: input.invoiceQuantity.toFixed(4),
      ok: true,
    });
  }

  const projectOk = input.poProjectId === input.invoiceProjectId;
  if (!projectOk) {
    issues.push({ type: 'INCORRECT_PROJECT' });
  }
  checks.push({
    key: 'project',
    label: 'Project',
    po: input.poProjectId,
    invoice: input.invoiceProjectId,
    ok: projectOk,
    reason: projectOk ? undefined : 'Invoice is not for this job’s purchase order.',
  });

  const supplierOk = input.poSupplierId === input.invoiceSupplierId;
  if (!supplierOk) {
    issues.push({ type: 'INCORRECT_SUPPLIER' });
  }
  checks.push({
    key: 'supplier',
    label: 'Supplier',
    po: input.poSupplierName ?? input.poSupplierId,
    invoice: input.invoiceSupplierName ?? input.invoiceSupplierId,
    ok: supplierOk,
    reason: supplierOk ? undefined : 'Supplier on the invoice is not the supplier on the purchase order.',
  });

  const missingCodes = input.poCostCodeIds.length > 0 && input.invoiceCostCodeIds.length === 0;
  const unexpected = input.invoiceCostCodeIds.filter((id) => !input.poCostCodeIds.includes(id));
  const costOk = !missingCodes && unexpected.length === 0;
  if (!costOk) {
    issues.push({
      type: 'INCORRECT_COST_CODE',
      detail: missingCodes ? 'missing' : unexpected.join(','),
    });
  }
  checks.push({
    key: 'cost_code',
    label: 'Cost code',
    po: labels(input.poCostCodeLabels ?? input.poCostCodeIds),
    invoice: labels(input.invoiceCostCodeLabels ?? input.invoiceCostCodeIds),
    ok: costOk,
    reason: costOk
      ? undefined
      : missingCodes
        ? 'Invoice has no cost code against the purchase order.'
        : 'Cost code differs from purchase order.',
  });

  const poLines = (input.poDescriptions ?? []).map(norm).filter(Boolean);
  const invoiceLines = (input.invoiceDescriptions ?? []).map(norm).filter(Boolean);
  const lineOk =
    poLines.length === 0 ||
    invoiceLines.length === 0 ||
    invoiceLines.every((line) => poLines.includes(line));
  if (!lineOk) {
    issues.push({ type: 'LINE_DESCRIPTION_MISMATCH' });
  }
  checks.push({
    key: 'line',
    label: 'Line items',
    po: labels(input.poDescriptions ?? []),
    invoice: labels(input.invoiceDescriptions ?? []),
    ok: lineOk,
    reason: lineOk ? undefined : 'Line items differ from the purchase order.',
  });

  const failed = checks.filter((item) => !item.ok);
  return {
    matched: issues.length === 0,
    issues,
    checks,
    summary: failed.map((item) => item.reason).filter(Boolean).join(' ') || 'PO and invoice match',
  };
}
