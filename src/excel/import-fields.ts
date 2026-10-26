import { CostCategory, ImportType, VariationStatus } from '@prisma/client';

export type FieldType = 'string' | 'money' | 'quantity' | 'date' | 'enum' | 'integer';

export type ImportField = {
  key: string;
  label: string;
  required: boolean;
  type: FieldType;
  aliases: string[];
  enumValues?: string[];
};

export type ColumnMap = Record<string, string | number>;

const COST_CATEGORIES = Object.values(CostCategory);
const VARIATION_STATUSES = Object.values(VariationStatus);

export const IMPORT_FIELDS: Record<ImportType, ImportField[]> = {
  BOQ: [
    field('itemCode', 'Item code', true, 'string', ['item no', 'item number', 'boq code', 'ref', 'line no', 'line']),
    field('description', 'Description', true, 'string', [
      'desc',
      'item description',
      'particulars',
      'scope item',
      'scope',
    ]),
    field('section', 'Section', false, 'string', ['heading', 'bill', 'trade']),
    field('category', 'Cost category', false, 'enum', ['cost category'], COST_CATEGORIES),
    field('costCode', 'Cost code', false, 'string', ['cost code', 'wbs', 'account']),
    field('quantity', 'Quantity', true, 'quantity', ['qty', 'quant']),
    field('unit', 'Unit', false, 'string', ['uom', 'unit of measure', 'um']),
    field('rate', 'Rate', true, 'quantity', ['unit rate', 'price', 'rate only', 'selling rate']),
    field('amount', 'Amount', false, 'money', ['total', 'extended', 'selling amount', 'subtotal']),
    field('costRate', 'Cost rate', false, 'quantity', ['costrate', 'contractor rate', 'our rate', 'cost unit rate']),
  ],
  BUDGET: [
    field('costCode', 'Cost code', true, 'string', ['code', 'wbs', 'account']),
    field('costCodeName', 'Cost code name', false, 'string', ['name', 'description', 'activity']),
    field('category', 'Cost category', false, 'enum', ['cost category'], COST_CATEGORIES),
    field('amount', 'Amount', true, 'money', ['budget', 'value', 'total', 'current budget']),
    field('originalAmount', 'Original amount', false, 'money', ['original budget', 'baseline']),
  ],
  COST: [
    field('description', 'Description', true, 'string', ['narration', 'details', 'particulars']),
    field('amount', 'Amount', true, 'money', ['value', 'total', 'cost']),
    field('transactionDate', 'Date', true, 'date', ['date', 'txn date', 'cost date']),
    field('costCode', 'Cost code', false, 'string', ['code', 'wbs', 'account']),
    field('reference', 'Reference', false, 'string', ['ref', 'doc no', 'voucher']),
    field('supplierName', 'Supplier', false, 'string', ['vendor', 'creditor', 'payee']),
    field('payeeName', 'Payee name', false, 'string', ['paid to']),
    field('taxAmount', 'Tax amount', false, 'money', ['vat', 'tax']),
  ],
  FORECAST: [
    field('costCode', 'Cost code', true, 'string', ['code', 'wbs']),
    field('amount', 'Forecast amount', true, 'money', ['etc', 'to complete', 'forecast', 'ctc']),
    field('reason', 'Assumptions', true, 'string', ['notes', 'assumption', 'comment']),
    field('period', 'Period', true, 'date', ['date', 'month', 'forecast date']),
  ],
  VARIATION: [
    field('variationNo', 'Variation number', true, 'string', ['vo no', 'vo', 'number', 'ref']),
    field('title', 'Title', true, 'string', ['name', 'heading']),
    field('description', 'Description', false, 'string', ['details']),
    field('reason', 'Reason', false, 'string', ['cause']),
    field('clientInstruction', 'Client instruction', false, 'string', ['instruction', 'ai']),
    field('instructionDate', 'Instruction date', false, 'date', ['date']),
    field('costCode', 'Cost code', false, 'string', ['code', 'wbs']),
    field('contractorCost', 'Contractor cost', true, 'money', ['cost', 'our cost']),
    field('sellingPrice', 'Selling price', true, 'money', ['value', 'price', 'claim']),
    field('status', 'Status', false, 'enum', ['state'], VARIATION_STATUSES),
  ],
  CLAIM: [
    field('claimNo', 'Claim number', true, 'string', ['certificate', 'ipc', 'claim']),
    field('periodStart', 'Period start', true, 'date', ['from', 'start']),
    field('periodEnd', 'Period end', true, 'date', ['to', 'end']),
    field('workCompleted', 'Work completed', true, 'money', ['gross', 'value completed', 'amount']),
    field('retentionAmount', 'Retention', false, 'money', ['retention']),
  ],
  COMMITMENT: [
    field('costCode', 'Cost code', true, 'string', ['code', 'wbs']),
    field('originalAmount', 'Committed amount', true, 'money', ['amount', 'value', 'po total']),
    field('supplierName', 'Supplier', false, 'string', ['vendor', 'subcontractor']),
    field('poNumber', 'PO number', false, 'string', ['po', 'order no']),
    field('description', 'Description', false, 'string', ['scope', 'notes']),
  ],
};

export function fieldsFor(type: ImportType): ImportField[] {
  return IMPORT_FIELDS[type];
}

export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function suggestColumnMap(headers: string[], type: ImportType): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  for (const field of fieldsFor(type)) {
    let bestIndex = -1;
    let bestScore = 0;
    headers.forEach((header, headerIndex) => {
      if (used.has(headerIndex) || !header.trim()) {
        return;
      }
      const score = headerMatchScore(header, field, type);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = headerIndex;
      }
    });
    if (bestIndex >= 0 && bestScore >= 80) {
      map[field.key] = headers[bestIndex];
      used.add(bestIndex);
    }
  }
  return map;
}

function headerMatchScore(header: string, field: ImportField, type: ImportType): number {
  const normalized = normalizeHeader(header);
  const candidates = [field.key, field.label, ...field.aliases].map(normalizeHeader);
  if (type === ImportType.BOQ) {
    if (field.key === 'rate' && normalized.includes('cost')) {
      return 0;
    }
    if (field.key === 'costCode') {
      return 0;
    }
    if (field.key === 'category' && normalized === 'category') {
      return 0;
    }
    if (field.key === 'section' && normalized === 'category') {
      return 100;
    }
    if (field.key === 'itemCode' && normalized === 'costcode') {
      return 100;
    }
    if (field.key === 'itemCode' && (header.trim() === '#' || normalized === 'no')) {
      return 100;
    }
    if (field.key === 'itemCode' && (normalized === 'scopeitem' || normalized === 'scope')) {
      return 0;
    }
    if (field.key === 'description' && (normalized === 'scopeitem' || normalized === 'scope')) {
      return 100;
    }
  }
  if (candidates.includes(normalized)) {
    return 100;
  }
  if (field.type === 'enum') {
    return 0;
  }
  for (const candidate of candidates) {
    if (candidate.length < 4 || normalized.length < 4) {
      continue;
    }
    if (normalized.includes(candidate) || candidate.includes(normalized)) {
      return 80;
    }
  }
  return 0;
}

function field(
  key: string,
  label: string,
  required: boolean,
  type: FieldType,
  aliases: string[],
  enumValues?: string[],
): ImportField {
  return { key, label, required, type, aliases, enumValues };
}
