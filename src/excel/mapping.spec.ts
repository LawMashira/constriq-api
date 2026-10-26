import { ImportType } from '@prisma/client';
import {
  applyColumnMap,
  parseCsv,
  resolveSourceIndex,
  validateMappedRows,
} from './mapping';
import { suggestColumnMap } from './import-fields';

describe('flexible column mapping', () => {
  const sheet = parseCsv(
    'Item No.,Desc,Qty,Rate,Spare\nA1,Excavate,10,25,ignore-me\nA2,Concrete,2,100,\n',
  );

  it('parses quoted csv and keeps unused columns as extras', () => {
    expect(sheet.headers).toEqual(['Item No.', 'Desc', 'Qty', 'Rate', 'Spare']);
    const mapped = applyColumnMap(sheet, ImportType.BOQ, {
      itemCode: 'Item No.',
      description: 'Desc',
      quantity: 'Qty',
      rate: 'Rate',
    });
    expect(mapped[0].values.itemCode).toBe('A1');
    expect(mapped[0].extras.Spare).toBe('ignore-me');
  });

  it('maps by header name, letter, or index', () => {
    expect(resolveSourceIndex('Item No.', sheet.headers)).toBe(0);
    expect(resolveSourceIndex('B', sheet.headers)).toBe(1);
    expect(resolveSourceIndex(2, sheet.headers)).toBe(2);
  });

  it('does not treat a BOQ Category column as cost category', () => {
    const withCategory = parseCsv(
      'Item No.,Description,Category,Qty,Rate\nA1,Excavate,Earthworks,10,25\n',
    );
    const suggested = suggestColumnMap(withCategory.headers, ImportType.BOQ);
    expect(suggested.section).toBe('Category');
    expect(suggested.category).toBeUndefined();
  });

  it('maps house-style BOQ headers without stealing unit or section', () => {
    const suggested = suggestColumnMap(
      ['Cost Code', 'Section', 'Item Description', 'Unit', 'Quantity', 'Rate (ZAR)', 'Amount (ZAR)'],
      ImportType.BOQ,
    );
    expect(suggested.itemCode).toBe('Cost Code');
    expect(suggested.section).toBe('Section');
    expect(suggested.description).toBe('Item Description');
    expect(suggested.unit).toBe('Unit');
    expect(suggested.quantity).toBe('Quantity');
    expect(suggested.rate).toBe('Rate (ZAR)');
    expect(suggested.amount).toBe('Amount (ZAR)');
    expect(suggested.category).toBeUndefined();
    expect(suggested.costCode).toBeUndefined();
  });

  it('drops duplicate section/unit mappings on a BOQ save', () => {
    const sheet = parseCsv(
      'Cost Code,Section,Item Description,Unit,Quantity,Rate (ZAR)\nPRE-001,Earthworks,Clear site,m²,180,18\n',
    );
    const mapped = applyColumnMap(sheet, ImportType.BOQ, {
      itemCode: 'Cost Code',
      section: 'Section',
      category: 'Section',
      description: 'Item Description',
      costCode: 'Unit',
      unit: 'Unit',
      quantity: 'Quantity',
      rate: 'Rate (ZAR)',
    });
    expect(mapped[0].values.category).toBeUndefined();
    expect(mapped[0].values.costCode).toBeUndefined();
    expect(mapped[0].values.unit).toBe('m²');
    expect(mapped[0].values.section).toBe('Earthworks');
  });

  it('does not import until rows pass validation', () => {
    const mapped = applyColumnMap(sheet, ImportType.BOQ, {
      itemCode: 'Item No.',
      description: 'Desc',
      quantity: 'Spare',
      rate: 'Rate',
    });
    const result = validateMappedRows(ImportType.BOQ, mapped);
    expect(result.errors.some((error) => error.field === 'quantity')).toBe(true);
  });

  it('imports a quotation-style BOQ with title rows and dollar rates', () => {
    const sheet = parseCsv(`Mhizha Construction – BOQ & Estimation Tool

Document Type	Quotation
Customer Name	Gweru City Council
#	Scope Item	UoM	Quantity	Unit Rate (USD)	Subtotal (USD)
1	Cement 32.5R (50kg)	Bag	400.00	$11.50	$4,600.00
2	River Sand	m³	60.00	$28.00	$1,680.00
9					-
				Subtotal (cost)	$20,716.00
`);
    expect(sheet.headers[0]).toBe('#');
    expect(sheet.headers[1]).toBe('Scope Item');
    const suggested = suggestColumnMap(sheet.headers, ImportType.BOQ);
    expect(suggested.itemCode).toBe('#');
    expect(suggested.description).toBe('Scope Item');
    expect(suggested.unit).toBe('UoM');
    expect(suggested.quantity).toBe('Quantity');
    expect(suggested.rate).toBe('Unit Rate (USD)');
    expect(suggested.amount).toBe('Subtotal (USD)');
    const mapped = applyColumnMap(sheet, ImportType.BOQ, suggested);
    const result = validateMappedRows(ImportType.BOQ, mapped);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(2);
    expect(result.valid[0].values.description).toBe('Cement 32.5R (50kg)');
    expect(result.valid[0].values.rate).toBe('$11.50');
  });

  it('accepts a valid BOQ mapping', () => {
    const mapped = applyColumnMap(sheet, ImportType.BOQ, {
      itemCode: 0,
      description: 1,
      quantity: 2,
      rate: 3,
    });
    const result = validateMappedRows(ImportType.BOQ, mapped);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(2);
  });
});
