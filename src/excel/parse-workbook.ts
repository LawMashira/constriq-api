import { parseCsv, ParsedSheet, sheetFromMatrix, stringifyCell } from './mapping';

export async function parseWorkbook(buffer: Buffer, fileName: string, sheetName?: string): Promise<ParsedSheet> {
  if (fileName.toLowerCase().endsWith('.csv')) {
    return parseCsv(buffer.toString('utf8'));
  }
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet =
    (sheetName ? workbook.worksheets.find((sheet) => sheet.name === sheetName) : undefined) ??
    workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Workbook has no sheets');
  }
  const matrix: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const count = Math.max(row.cellCount, 1);
    for (let index = 1; index <= count; index += 1) {
      cells.push(excelCell(row.getCell(index).value));
    }
    matrix.push(cells);
  });
  return sheetFromMatrix(matrix, worksheet.name);

function excelCell(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in (value as { text?: string })) {
    return stringifyCell((value as { text: string }).text);
  }
  if (value && typeof value === 'object' && 'result' in (value as { result?: unknown })) {
    return stringifyCell((value as { result: unknown }).result);
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = excelSerialToDate(value);
    if (date) {
      return date;
    }
  }
  return stringifyCell(value);
}

function excelSerialToDate(serial: number): string | null {
  const utc = Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
