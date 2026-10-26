import { ColumnMap, fieldsFor, ImportField, normalizeHeader } from './import-fields';
import { ImportType } from '@prisma/client';

export type ParsedSheet = {
  sheetName: string;
  headers: string[];
  rows: string[][];
};

export type MappedRow = {
  rowNumber: number;
  values: Record<string, string>;
  extras: Record<string, string>;
};

export function columnLetterToIndex(letter: string): number {
  const value = letter.trim().toUpperCase();
  let index = 0;
  for (const char of value) {
    if (char < 'A' || char > 'Z') {
      return Number.NaN;
    }
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

export function resolveSourceIndex(source: string | number, headers: string[]): number {
  if (typeof source === 'number') {
    return source;
  }
  const trimmed = source.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length <= 3) {
    const fromLetter = columnLetterToIndex(trimmed);
    if (!Number.isNaN(fromLetter) && fromLetter < headers.length) {
      return fromLetter;
    }
  }
  const exact = headers.findIndex((header) => header === trimmed);
  if (exact >= 0) {
    return exact;
  }
  const insensitive = headers.findIndex(
    (header) => header.toLowerCase().trim() === trimmed.toLowerCase(),
  );
  return insensitive;
}

export function sanitizeColumnMap(
  headers: string[],
  type: ImportType,
  columnMap: ColumnMap,
): ColumnMap {
  const used = new Set<number>();
  const out: ColumnMap = {};
  for (const field of fieldsFor(type)) {
    const source = columnMap[field.key];
    if (source === undefined || source === null || source === '') {
      continue;
    }
    const columnIndex = resolveSourceIndex(source, headers);
    if (columnIndex < 0 || Number.isNaN(columnIndex) || used.has(columnIndex)) {
      continue;
    }
    const headerName = headers[columnIndex] ?? '';
    const normalized = headerName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (type === ImportType.BOQ && field.key === 'category') {
      if (normalized !== 'costcategory' && normalized !== 'costcat') {
        continue;
      }
    }
    if (
      type === ImportType.BOQ &&
      field.key === 'costCode' &&
      ['unit', 'uom', 'um', 'unitofmeasure', 'qty', 'quantity', 'rate', 'amount', 'costrate'].includes(
        normalized,
      )
    ) {
      continue;
    }
    used.add(columnIndex);
    out[field.key] = headerName || source;
  }
  return out;
}

export function applyColumnMap(
  sheet: ParsedSheet,
  type: ImportType,
  columnMap: ColumnMap,
): MappedRow[] {
  const fields = fieldsFor(type);
  const resolved = sanitizeColumnMap(sheet.headers, type, columnMap);
  return sheet.rows.map((cells, index) => {
    const values: Record<string, string> = {};
    const mappedIndexes = new Set<number>();
    for (const field of fields) {
      const source = resolved[field.key];
      if (source === undefined || source === null || source === '') {
        continue;
      }
      const columnIndex = resolveSourceIndex(source, sheet.headers);
      if (columnIndex < 0 || Number.isNaN(columnIndex)) {
        continue;
      }
      mappedIndexes.add(columnIndex);
      values[field.key] = stringifyCell(cells[columnIndex]);
    }
    const extras: Record<string, string> = {};
    sheet.headers.forEach((header, columnIndex) => {
      if (mappedIndexes.has(columnIndex) || !header) {
        return;
      }
      const value = stringifyCell(cells[columnIndex]);
      if (value) {
        extras[header] = value;
      }
    });
    return { rowNumber: index + 2, values, extras };
  });
}

export type RowIssue = {
  rowNumber: number;
  field?: string;
  message: string;
};

export function validateMappedRows(
  type: ImportType,
  rows: MappedRow[],
): { errors: RowIssue[]; valid: MappedRow[] } {
  const fields = fieldsFor(type);
  const errors: RowIssue[] = [];
  const valid: MappedRow[] = [];
  for (const row of rows) {
    const blank = fields.every((field) => !row.values[field.key]?.trim()) && !Object.keys(row.extras).length;
    if (blank || (type === ImportType.BOQ && isPlaceholderBoqRow(row))) {
      continue;
    }
    let failed = false;
    for (const field of fields) {
      const issue = validateField(field, row.values[field.key] ?? '');
      if (issue) {
        failed = true;
        errors.push({ rowNumber: row.rowNumber, field: field.key, message: issue });
      }
    }
    if (!failed) {
      valid.push(row);
    }
  }
  return { errors, valid };
}

function validateField(field: ImportField, raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return field.required ? `${field.label} is required` : null;
  }
  if (field.type === 'money' || field.type === 'quantity') {
    if (!/^-?\d+(\.\d+)?$/.test(stripMoneyNoise(value))) {
      return `${field.label} must be numeric`;
    }
  }
  if (field.type === 'date' && Number.isNaN(Date.parse(value)) && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return `${field.label} must be a date`;
  }
  if (field.type === 'enum' && field.enumValues) {
    const coerced = coerceEnum(value, field.enumValues);
    if (!coerced) {
      if (!field.required) {
        return null;
      }
      return `${field.label} must be one of: ${field.enumValues.join(', ')}`;
    }
  }
  return null;
}

function coerceEnum(value: string, allowed: string[]): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '_');
  if (allowed.includes(normalized)) {
    return normalized;
  }
  const aliases: Record<string, string> = {
    PRELIM: 'PRELIMINARIES',
    PRELIMS: 'PRELIMINARIES',
    PRELIMINARY: 'PRELIMINARIES',
    LABOR: 'LABOUR',
    MATERIAL: 'MATERIALS',
    MATS: 'MATERIALS',
    SUBCONTRACT: 'SUBCONTRACTORS',
    SUBCONTRACTOR: 'SUBCONTRACTORS',
    SUBBIE: 'SUBCONTRACTORS',
    PLANT_HIRE: 'PLANT',
    OH: 'SITE_OVERHEADS',
    OVERHEADS: 'SITE_OVERHEADS',
    OVERHEAD: 'SITE_OVERHEADS',
    SITE_OVERHEAD: 'SITE_OVERHEADS',
    PROFESSIONAL: 'PROFESSIONAL_SERVICES',
    PROFESSIONALS: 'PROFESSIONAL_SERVICES',
    GENERAL: 'GENERAL_EXPENSES',
    EXPENSES: 'GENERAL_EXPENSES',
  };
  const aliased = aliases[normalized];
  if (aliased && allowed.includes(aliased)) {
    return aliased;
  }
  return null;
}

const TABLE_HEADER_TOKENS = [
  'quantity',
  'qty',
  'unit',
  'uom',
  'rate',
  'unitrate',
  'amount',
  'subtotal',
  'description',
  'scopeitem',
  'itemdescription',
  'itemno',
  'itemcode',
  'costcode',
];

export function findHeaderRowIndex(matrix: string[][]): number {
  let bestIndex = 0;
  let bestScore = 0;
  const limit = Math.min(matrix.length, 60);
  for (let index = 0; index < limit; index += 1) {
    const score = (matrix[index] ?? []).reduce((total, cell) => {
      const trimmed = cell.trim();
      if (trimmed === '#') {
        return total + 1;
      }
      const normalized = normalizeHeader(trimmed);
      if (!normalized) {
        return total;
      }
      const hit = TABLE_HEADER_TOKENS.some(
        (token) => normalized === token || (token.length >= 4 && normalized.includes(token)),
      );
      return hit ? total + 1 : total;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore >= 3 ? bestIndex : 0;
}

export function sheetFromMatrix(matrix: string[][], sheetName = 'Sheet1'): ParsedSheet {
  const headerIndex = findHeaderRowIndex(matrix);
  const headerRow = matrix[headerIndex] ?? [];
  const headers = headerRow.map((header, index) => header || `Column${index + 1}`);
  const width = Math.max(headers.length, 1);
  const rows = matrix.slice(headerIndex + 1).map((row) => {
    const padded = [...row];
    while (padded.length < width) {
      padded.push('');
    }
    return padded.slice(0, width);
  });
  return { sheetName, headers, rows };
}

export function stripMoneyNoise(value: string): string {
  return value
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/^(us\$|usd|zar|r|\$|€|£)+/i, '')
    .replace(/(us\$|usd|zar)$/i, '');
}

function isPlaceholderBoqRow(row: MappedRow): boolean {
  const description = (row.values.description ?? '').trim();
  const quantity = stripMoneyNoise(row.values.quantity ?? '');
  const rate = stripMoneyNoise(row.values.rate ?? '');
  const emptyish = (value: string) => !value || value === '-' || value === '—' || value === '.';
  if (/^subtotal/i.test(description) || /^subtotal/i.test(rate) || /^subtotal/i.test(quantity)) {
    return true;
  }
  return emptyish(description) && !/^-?\d+(\.\d+)?$/.test(quantity);
}

export function stringifyCell(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return String(value).trim();
}

export function parseCsv(text: string): ParsedSheet {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length);
  const delimiter = lines.some((line) => (line.match(/\t/g) ?? []).length > (line.match(/,/g) ?? []).length)
    ? '\t'
    : ',';
  const table = lines.map((line) => (delimiter === '\t' ? line.split('\t') : splitCsvLine(line)));
  return sheetFromMatrix(table);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
