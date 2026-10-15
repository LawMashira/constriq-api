import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { jsonMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';

const NAVY = '#0b1f33';
const NAVY_800 = '#132a42';
const COPPER = '#c45c26';
const PAPER = '#f7f1e6';
const ROW_ALT = '#f3ead8';
const LINE = '#e4d9c4';
const MUTED = '#6b6256';
const WHITE = '#ffffff';

const MARGIN_X = 40;
const HEADER_H = 102;
const FOOTER_H = 48;

type PdfDoc = InstanceType<typeof PDFDocument>;

interface ReportMeta {
  companyName: string;
  projectCode: string;
  projectName: string;
  currency: string;
}

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

@Injectable()
export class PdfService {
  constructor(
    private readonly profit: ProfitEngineService,
    private readonly prisma: PrismaService,
  ) {}

  async profitability(companyId: string, projectId: string): Promise<Buffer> {
    const [meta, snapshot] = await Promise.all([
      this.meta(companyId, projectId),
      this.profit.recalculate(companyId, projectId),
    ]);
    const money = (value: Parameters<typeof jsonMoney>[0]) => this.money(jsonMoney(value), meta.currency);
    return this.document(meta, 'Profitability', (doc, y) => {
      y = this.kpis(
        doc,
        y,
        [
          ['Original contract', money(snapshot.originalContractValue)],
          ['Approved contract', money(snapshot.currentApprovedContractValue)],
          ['Original expected profit', money(snapshot.originalExpectedProfit)],
          ['Forecast profit', money(snapshot.forecastProfit)],
        ],
      );
      return this.table(
        doc,
        y,
        [
          { label: 'Measure', width: 0.58 },
          { label: 'Amount', width: 0.42, align: 'right' },
        ],
        [
          ['Original contract value', money(snapshot.originalContractValue)],
          ['Current approved contract value', money(snapshot.currentApprovedContractValue)],
          ['Approved variations', money(snapshot.qualifyingVariationRevenue)],
          ['Pending variations', money(snapshot.unapprovedVariationExposure)],
          ['Original expected costs', money(snapshot.originalBudget)],
          ['Current approved budget', money(snapshot.currentBudget)],
          ['Actual cost', money(snapshot.actualCost)],
          ['Outstanding commitments', money(snapshot.openCommittedCost)],
          ['Forecast to complete', money(snapshot.forecastUncommittedCost)],
          [
            'Forecast final cost',
            snapshot.costEstimateIncomplete ? 'Not yet estimated' : money(snapshot.forecastFinalCost),
          ],
          ['Original expected profit', money(snapshot.originalExpectedProfit)],
          [
            'Current forecast profit',
            snapshot.costEstimateIncomplete ? 'Uncertain until costs are estimated' : money(snapshot.forecastProfit),
          ],
          ['Profit at risk', money(snapshot.profitAtRisk)],
          [
            'Cost estimate',
            snapshot.costEstimateIncomplete ? 'Incomplete — unknown costs are not assumed to be zero' : 'Recorded',
          ],
          ['Forecast margin', snapshot.forecastMargin != null ? `${Number(snapshot.forecastMargin).toFixed(2)}%` : '—'],
        ],
        meta,
        'Profitability',
      );
    });
  }

  async costs(companyId: string, projectId: string) {
    const [meta, rows] = await Promise.all([
      this.meta(companyId, projectId),
      this.prisma.actualCost.findMany({
        where: { companyId, projectId },
        orderBy: { transactionDate: 'asc' },
      }),
    ]);
    return this.document(meta, 'Cost ledger', (doc, y) =>
      this.table(
        doc,
        y,
        [
          { label: 'Date', width: 0.18 },
          { label: 'Description', width: 0.54 },
          { label: 'Amount', width: 0.28, align: 'right' },
        ],
        rows.map((item) => [
          this.date(item.transactionDate),
          item.description,
          this.money(item.amount.toFixed(2), meta.currency),
        ]),
        meta,
        'Cost ledger',
      ),
    );
  }

  async variations(companyId: string, projectId: string) {
    const [meta, rows] = await Promise.all([
      this.meta(companyId, projectId),
      this.prisma.variation.findMany({
        where: { companyId, projectId },
        orderBy: { variationNo: 'asc' },
      }),
    ]);
    return this.document(meta, 'Variation schedule', (doc, y) =>
      this.table(
        doc,
        y,
        [
          { label: 'VO', width: 0.12 },
          { label: 'Title', width: 0.3 },
          { label: 'Status', width: 0.16 },
          { label: 'Cost', width: 0.21, align: 'right' },
          { label: 'Price / Revenue', width: 0.21, align: 'right' },
        ],
        rows.map((item) => [
          item.variationNo,
          item.title,
          item.status,
          this.money(item.contractorCost.toFixed(2), meta.currency),
          this.money(item.sellingPrice.toFixed(2), meta.currency),
        ]),
        meta,
        'Variation schedule',
      ),
    );
  }

  async claims(companyId: string, projectId: string) {
    const [meta, rows] = await Promise.all([
      this.meta(companyId, projectId),
      this.prisma.progressClaim.findMany({
        where: { companyId, projectId },
        orderBy: { claimNo: 'asc' },
      }),
    ]);
    return this.document(meta, 'Progress claims', (doc, y) =>
      this.table(
        doc,
        y,
        [
          { label: 'Claim', width: 0.16 },
          { label: 'Period', width: 0.28 },
          { label: 'Status', width: 0.18 },
          { label: 'Net amount', width: 0.38, align: 'right' },
        ],
        rows.map((item) => [
          item.claimNo,
          `${this.date(item.periodStart)} – ${this.date(item.periodEnd)}`,
          item.status,
          this.money(item.netAmount.toFixed(2), meta.currency),
        ]),
        meta,
        'Progress claims',
      ),
    );
  }

  async cashFlow(companyId: string, projectId: string) {
    const [meta, cash] = await Promise.all([
      this.meta(companyId, projectId),
      this.profit.cashFlow(companyId, projectId),
    ]);
    const rows: string[][] = [
      ['Position', 'Net', this.money(cash.netPosition, meta.currency)],
      ...cash.inflows.map((item) => ['Inflow', item.source, this.money(item.amount, meta.currency)]),
      ...cash.outflows.map((item) => ['Outflow', item.source, this.money(item.amount, meta.currency)]),
    ];
    return this.document(meta, 'Cash flow', (doc, y) =>
      this.table(
        doc,
        y,
        [
          { label: 'Direction', width: 0.22 },
          { label: 'Source', width: 0.46 },
          { label: 'Amount', width: 0.32, align: 'right' },
        ],
        rows,
        meta,
        'Cash flow',
      ),
    );
  }

  async leakage(companyId: string, projectId: string) {
    const [meta, rows] = await Promise.all([
      this.meta(companyId, projectId),
      this.prisma.leakageFinding.findMany({
        where: { companyId, projectId, status: 'OPEN' },
        orderBy: { rank: 'asc' },
      }),
    ]);
    return this.document(meta, 'Leakage', (doc, y) =>
      this.table(
        doc,
        y,
        [
          { label: 'Finding', width: 0.5 },
          { label: 'Severity', width: 0.18 },
          { label: 'Impact', width: 0.32, align: 'right' },
        ],
        rows.map((item) => [
          item.title,
          item.severity,
          this.money(item.financialImpact.toFixed(2), meta.currency),
        ]),
        meta,
        'Leakage',
      ),
    );
  }

  private async meta(companyId: string, projectId: string): Promise<ReportMeta> {
    const [company, project] = await Promise.all([
      this.prisma.company.findFirst({ where: { id: companyId } }),
      this.prisma.project.findFirst({ where: { id: projectId, companyId } }),
    ]);
    return {
      companyName: company?.legalName ?? 'CONSTRIQ',
      projectCode: project?.code ?? '',
      projectName: project?.name ?? 'Project',
      currency: company?.currency ?? 'ZAR',
    };
  }

  private document(
    meta: ReportMeta,
    title: string,
    draw: (doc: PdfDoc, y: number) => number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `CONSTRIQ ${title}`, Author: 'CONSTRIQ' } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      let y = this.chrome(doc, meta, title, 1);
      y = this.intro(doc, meta, y);
      draw(doc, y);

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        this.footer(doc, i + 1, range.count);
      }
      doc.end();
    });
  }

  private chrome(doc: PdfDoc, meta: ReportMeta, title: string, pageNo: number): number {
    const w = doc.page.width;
    doc.save();
    doc.rect(0, 0, w, HEADER_H).fill(NAVY);
    doc.rect(0, HEADER_H, w, 5).fill(COPPER);
    const logo = this.logoPath();
    if (logo) {
      try {
        doc.save();
        doc.roundedRect(MARGIN_X - 6, 16, 216, 70, 10).fill(WHITE);
        doc.restore();
        doc.image(logo, MARGIN_X, 20, { fit: [200, 62], height: 62 });
      } catch {
        this.wordmark(doc);
      }
    } else {
      this.wordmark(doc);
    }
    doc
      .fillColor(WHITE)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(title.toUpperCase(), w - 280, 28, { width: 240, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#d4c4b0')
      .text(meta.companyName, w - 280, 50, { width: 240, align: 'right' });
    doc.text(`Prepared ${this.date(new Date())}`, w - 280, 64, { width: 240, align: 'right' });
    doc.restore();
    void pageNo;
    return HEADER_H + 22;
  }

  private footer(doc: PdfDoc, page: number, total: number) {
    const w = doc.page.width;
    const h = doc.page.height;
    doc.save();
    doc.rect(0, h - FOOTER_H, w, FOOTER_H).fill(NAVY);
    doc.rect(0, h - FOOTER_H - 4, w, 4).fill(COPPER);
    doc
      .fillColor('#d4c4b0')
      .font('Helvetica')
      .fontSize(8)
      .text('CONSTRIQ  ·  Know your project. Protect your profit.', MARGIN_X, h - 30, {
        width: w - 160,
      });
    doc.text(`${page} / ${total}`, w - 90, h - 30, { width: 50, align: 'right' });
    doc.restore();
  }

  private intro(doc: PdfDoc, meta: ReportMeta, y: number): number {
    const inner = this.innerWidth(doc);
    doc.save();
    doc.roundedRect(MARGIN_X, y, inner, 46, 8).fill(PAPER);
    doc
      .fillColor(NAVY)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`${meta.projectCode}  ·  ${meta.projectName}`, MARGIN_X + 14, y + 10, { width: inner - 28 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text('Confidential commercial position. Figures follow CONSTRIQ postings, not spreadsheet estimates.', MARGIN_X + 14, y + 26, {
        width: inner - 28,
      });
    doc.restore();
    return y + 62;
  }

  private kpis(doc: PdfDoc, y: number, items: Array<[string, string]>): number {
    const gap = 10;
    const inner = this.innerWidth(doc);
    const boxW = (inner - gap) / 2;
    const boxH = 52;
    items.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = MARGIN_X + col * (boxW + gap);
      const top = y + row * (boxH + gap);
      doc.save();
      doc.roundedRect(x, top, boxW, boxH, 8).fill(index % 3 === 0 ? NAVY : WHITE);
      doc.roundedRect(x, top, boxW, boxH, 8).lineWidth(0.8).stroke(index % 3 === 0 ? NAVY : LINE);
      const dark = index % 3 === 0;
      doc
        .fillColor(dark ? '#d4c4b0' : MUTED)
        .font('Helvetica')
        .fontSize(7)
        .text(item[0].toUpperCase(), x + 12, top + 10, { width: boxW - 24 });
      doc
        .fillColor(dark ? WHITE : NAVY)
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(item[1], x + 12, top + 24, { width: boxW - 24 });
      doc.restore();
    });
    const rows = Math.ceil(items.length / 2);
    return y + rows * (boxH + gap) + 8;
  }

  private table(
    doc: PdfDoc,
    startY: number,
    columns: Column[],
    rows: string[][],
    meta: ReportMeta,
    title: string,
  ): number {
    const inner = this.innerWidth(doc);
    const bottom = doc.page.height - FOOTER_H - 16;
    let y = startY;
    const paintHeader = () => {
      doc.save();
      doc.rect(MARGIN_X, y, inner, 26).fill(NAVY_800);
      let x = MARGIN_X;
      columns.forEach((col) => {
        const w = inner * col.width;
        doc
          .fillColor('#d4c4b0')
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(col.label.toUpperCase(), x + 8, y + 8, { width: w - 16, align: col.align ?? 'left' });
        x += w;
      });
      doc.restore();
      y += 26;
    };
    paintHeader();
    if (rows.length === 0) {
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9)
        .text('No records for this report yet.', MARGIN_X + 8, y + 12, { width: inner - 16 });
      return y + 36;
    }
    rows.forEach((row, index) => {
      doc.font('Helvetica').fontSize(9);
      const heights = row.map((cell, i) => {
        const w = inner * columns[i].width - 16;
        return doc.heightOfString(cell || '—', { width: w });
      });
      const rowH = Math.max(22, ...heights) + 10;
      if (y + rowH > bottom) {
        doc.addPage();
        y = this.chrome(doc, meta, title, 1);
        paintHeader();
      }
      doc.save();
      doc.rect(MARGIN_X, y, inner, rowH).fill(index % 2 === 0 ? WHITE : ROW_ALT);
      let x = MARGIN_X;
      columns.forEach((col, i) => {
        const w = inner * col.width;
        doc
          .fillColor(NAVY)
          .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(9)
          .text(row[i] || '—', x + 8, y + 6, { width: w - 16, align: col.align ?? 'left' });
        x += w;
      });
      doc.restore();
      y += rowH;
    });
    doc.save();
    doc.moveTo(MARGIN_X, y).lineTo(MARGIN_X + inner, y).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.restore();
    return y + 12;
  }

  private innerWidth(doc: PdfDoc) {
    return doc.page.width - MARGIN_X * 2;
  }

  private wordmark(doc: PdfDoc) {
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(22).text('CONSTRIQ', MARGIN_X, 36);
  }

  private logoPath(): string | null {
    const candidates = [
      join(__dirname, '..', 'assets', 'constriq.jpg'),
      join(process.cwd(), 'src', 'assets', 'constriq.jpg'),
      join(process.cwd(), 'assets', 'constriq.jpg'),
    ];
    return candidates.find((path) => existsSync(path)) ?? null;
  }

  private money(value: string | null | undefined, currency: string) {
    if (value == null || value === '') return '—';
    const amount = Number(value);
    if (Number.isNaN(amount)) return value;
    const formatted = amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency === 'ZAR' ? `R ${formatted}` : `${currency} ${formatted}`;
  }

  private date(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
