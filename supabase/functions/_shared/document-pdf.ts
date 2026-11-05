import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import { formatMoney } from './money.ts';

export type DocType = 'quotation' | 'invoice' | 'receipt';

export interface DocumentRow {
  name: string;
  material?: string | null;
  colour?: string | null;
  measurements?: string | null;
  customRequirements?: string | null;
  extraLine?: string | null;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export interface DocumentModel {
  type: DocType;
  currency: string;
  numberLabel: string;
  number: string;
  dateText: string;
  validUntilText?: string;
  issuer: { name: string; phone: string; email: string };
  client: { name: string; address?: string | null; phone?: string | null; email?: string | null };
  rows: DocumentRow[];
  emptyRowsText: string;
  totals: {
    lines: Array<{ label: string; cents: number | null }>;
    band: { label: string; cents: number | null };
    discount?: number | null;
    receipt?: { orderTotal: number | null; totalPaid: number; balanceRemaining: number | null };
  };
  config: {
    title: string;
    intro: string;
    closing?: string;
    showTerms: boolean;
    showPayment: boolean;
    showValidUntil?: boolean;
    lastPageNote?: string;
  };
}

const DISPLAY_FONT_URL = 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vCJG.ttf';
const BODY_FONT_URL = 'https://fonts.gstatic.com/s/worksans/v24/QGY_z_wNahGAdqQ43RhVcIgYT2Xz5u32K0nXNig.ttf';
const BODY_BOLD_FONT_URL = 'https://fonts.gstatic.com/s/worksans/v24/QGY_z_wNahGAdqQ43RhVcIgYT2Xz5u32K67QNig.ttf';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const BUSINESS_NAME = 'David Wang Incorporated';
const LEGAL_NAME = 'David Wang Incorporated';
const BUSINESS_ADDRESS = Deno.env.get('BUSINESS_ADDRESS') ?? 'Not configured';
const SIGNATURE_URL = `${SUPABASE_URL}/storage/v1/object/public/public-assets/signature.png`;

const PAYMENT_INSTRUCTIONS_BLOCKS = [
  {
    country: 'Zimbabwe',
    lines: [
      `Bank: ${Deno.env.get('BANK_ZW_NAME') ?? 'Not configured'}`,
      `Account Type: ${Deno.env.get('BANK_ZW_ACCOUNT_TYPE') ?? 'Not configured'}`,
      `Account Number: ${Deno.env.get('BANK_ZW_ACCOUNT_NUMBER') ?? 'Not configured'}`,
      `Branch: ${Deno.env.get('BANK_ZW_BRANCH') ?? 'Not configured'}`,
      'Ref: Name + Surname',
    ],
  },
  {
    country: 'South Africa',
    lines: [
      `Bank: ${Deno.env.get('BANK_SA_NAME') ?? 'Not configured'}`,
      `Account Number: ${Deno.env.get('BANK_SA_ACCOUNT_NUMBER') ?? 'Not configured'}`,
      `Branch: ${Deno.env.get('BANK_SA_BRANCH') ?? 'Not configured'}`,
      'Ref: Name + Surname',
    ],
  },
  {
    country: 'EcoCash',
    lines: [
      `Number: ${Deno.env.get('ECOCASH_NUMBER') ?? 'Not configured'}`,
      `Name: ${Deno.env.get('ECOCASH_NAME') ?? 'Not configured'}`,
      `Position: ${Deno.env.get('ECOCASH_POSITION') ?? 'Not configured'}`,
      'Ref: Name + Surname',
    ],
  },
];

const TERMS = [
  'This quotation is valid for 14 days from the date of issue.',
  'A 50% deposit confirms your order and moves it into production. Our standard lead time is usually 14-21 days.',
  'Cash deposits may be made at our showroom located in Eastlea or our offices in Carrick Creagh',
  'Production will begin only once payment has been received and confirmed.',
  'As all furniture is custom-made to the client’s specifications, orders cannot be cancelled, returned, or refunded once production has commenced.',
  'The estimated production lead time is 2–3 weeks, subject to material availability and order volume.',
  'Fabric, leather, timber grain, marble, and other natural materials may vary slightly from samples due to their inherent characteristics.',
  'Delivery charges are quoted separately unless otherwise stated. Delivery dates are estimates and may be affected by circumstances beyond our control.',
  'The client is responsible for ensuring suitable access for delivery. Any additional costs resulting from restricted access or failed delivery attempts will be charged separately.',
  'Any changes requested after order confirmation may incur additional charges and extend the production lead time.',
  'All furniture is thoroughly inspected prior to dispatch to ensure it meets our quality standards.',
  'Ownership of all goods remains with David Wang until full payment has been received.',
];

const INK = rgb(0.1, 0.1, 0.1);
const WHITE = rgb(1, 1, 1);
const WALNUT = rgb(0.36, 0.25, 0.2);
const GREY = rgb(0.38, 0.38, 0.38);
const GREY_RULE = rgb(0.72, 0.72, 0.72);
const HAIRLINE = rgb(0.74, 0.74, 0.7);
const TINT: any = rgb(0.957, 0.945, 0.925);
const RULE_STRONG = rgb(0.55, 0.55, 0.55);
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;
const CONTENT_WIDTH = RIGHT_EDGE - MARGIN;
const BOTTOM_LIMIT = 60;
const PAD = 8;

const toCents = (value: number | string) => Math.round(Number(value) * 100);
const centredBaseline = (rowBottom: number, rowHeight: number, size: number) => rowBottom + (rowHeight - size * 0.7) / 2;

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

async function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load font: ${url}`);
  return response.arrayBuffer();
}

function drawPhoneIcon(page: any, x: number, baselineY: number, size = 9) {
  const width = size * 0.62;
  const height = size * 1.1;
  const y0 = baselineY - size * 0.2;
  page.drawRectangle({ x, y: y0, width, height, borderColor: WALNUT, borderWidth: 0.8 });
  page.drawCircle({ x: x + width / 2, y: y0 + height * 0.18, size: 0.6, color: WALNUT });
  return width;
}

function drawEnvelopeIcon(page: any, x: number, baselineY: number, size = 9) {
  const width = size * 1.25;
  const height = size * 0.85;
  const y0 = baselineY - size * 0.15;
  page.drawRectangle({ x, y: y0, width, height, borderColor: WALNUT, borderWidth: 0.8 });
  page.drawLine({ start: { x, y: y0 + height }, end: { x: x + width / 2, y: y0 + height * 0.4 }, thickness: 0.8, color: WALNUT });
  page.drawLine({ start: { x: x + width / 2, y: y0 + height * 0.4 }, end: { x: x + width, y: y0 + height }, thickness: 0.8, color: WALNUT });
  return width;
}

export async function buildDocumentPdf(model: DocumentModel): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  let display: any;
  let font: any;
  let bold: any;
  let usingFallbackFonts = false;
  try {
    const [displayBytes, bodyBytes, bodyBoldBytes] = await Promise.all([
      fetchFontBytes(DISPLAY_FONT_URL), fetchFontBytes(BODY_FONT_URL), fetchFontBytes(BODY_BOLD_FONT_URL),
    ]);
    const fontOptions = { features: { liga: false, clig: false, dlig: false } };
    display = await pdfDoc.embedFont(displayBytes, fontOptions);
    font = await pdfDoc.embedFont(bodyBytes, fontOptions);
    bold = await pdfDoc.embedFont(bodyBoldBytes, fontOptions);
  } catch {
    usingFallbackFonts = true;
    display = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  let signatureImage: any = null;
  try {
    const response = await fetch(SIGNATURE_URL);
    if (!response.ok) throw new Error('Signature fetch failed.');
    signatureImage = await pdfDoc.embedPng(await response.arrayBuffer());
  } catch {
    signatureImage = null;
  }

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 40;
  const DESCRIPTION_X = MARGIN + 28;
  const DESCRIPTION_WIDTH = 290 - PAD;
  const QTY_RIGHT = 410 - PAD;
  const PRICE_RIGHT = 478 - PAD;
  const VALUE_RIGHT = RIGHT_EDGE - PAD;
  const ROW_PAD_TOP = 10;
  const ROW_PAD_BOTTOM = 8;
  const NAME_SIZE = 10;
  const NAME_LINE_H = 13;
  const SPEC_LINE_H = 11;
  const TOTALS_GAP_TOP = 20;
  const TOTALS_ROW_H = 18;
  const TOTALS_GAP_BAND = 10;
  const GT_ROW_H = 26;
  const FOOTER_GAP_TOP = 18;
  const rightText = (text: string, rightX: number, yy: number, f: any, size: number, color = INK) =>
    page.drawText(text, { x: rightX - f.widthOfTextAtSize(text, size), y: yy, size, font: f, color });
  const rightMoney = (text: string, rightX: number, yy: number, f: any, size: number, maxWidth: number, color = INK) => {
    let fittedSize = size;
    while (f.widthOfTextAtSize(text, fittedSize) > maxWidth && fittedSize > 7) fittedSize -= 0.5;
    rightText(text, rightX, yy, f, fittedSize, color);
  };
  const dotted = (yy: number) => page.drawLine({
    start: { x: MARGIN, y: yy }, end: { x: RIGHT_EDGE, y: yy }, thickness: 0.5, color: GREY_RULE, dashArray: [1.5, 2],
  });
  const centerInBox = (text: string, x: number, width: number, yy: number, f: any, size: number, color = INK) =>
    page.drawText(text, { x: x + (width - f.widthOfTextAtSize(text, size)) / 2, y: yy, size, font: f, color });
  const formatCents = (cents: number) => formatMoney(cents / 100, model.currency);
  const formatTotal = (cents: number | null) => cents == null ? 'TBC' : formatCents(cents);

  const drawContinuationHeader = () => {
    page.drawText(`${model.config.title} ${model.number} (continued)`, { x: MARGIN, y: PAGE_HEIGHT - 40, size: 9, font: bold, color: WALNUT });
    y = PAGE_HEIGHT - 70;
  };
  const newContinuationPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawContinuationHeader();
  };
  const drawTableHeader = () => {
    const headerTop = y;
    const headerHeight = 24;
    const headerBottom = headerTop - headerHeight;
    const labelY = centredBaseline(headerBottom, headerHeight, 9);
    page.drawRectangle({ x: MARGIN, y: headerBottom, width: CONTENT_WIDTH, height: headerHeight, color: TINT });
    page.drawLine({ start: { x: MARGIN, y: headerTop }, end: { x: RIGHT_EDGE, y: headerTop }, thickness: 0.9, color: RULE_STRONG });
    page.drawText('#', { x: MARGIN + PAD, y: labelY, size: 9, font: bold, color: INK });
    page.drawText('DESCRIPTION', { x: DESCRIPTION_X, y: labelY, size: 9, font: bold, color: INK });
    rightText('QTY', QTY_RIGHT, labelY, bold, 9);
    rightText('PRICE', PRICE_RIGHT, labelY, bold, 9);
    rightText('TOTAL', VALUE_RIGHT, labelY, bold, 9);
    page.drawLine({ start: { x: MARGIN, y: headerBottom }, end: { x: RIGHT_EDGE, y: headerBottom }, thickness: 0.9, color: RULE_STRONG });
    y = headerBottom;
  };

  const HEADER_TOP = PAGE_HEIGHT - 44;
  const HEADER_HEIGHT = 100;
  const HEADER_MID_Y = HEADER_TOP - HEADER_HEIGHT / 2;
  const PAGE_CENTER_X = PAGE_WIDTH / 2;
  const logoSize = 62;
  const logoRadius = logoSize / 2;
  const logoCenterX = MARGIN + logoRadius;
  const logoCenterY = HEADER_MID_Y;
  const logoX = logoCenterX - logoRadius;
  const logoY = logoCenterY - logoRadius;
  page.drawEllipse({ x: logoCenterX, y: logoCenterY, xScale: logoRadius, yScale: logoRadius, borderColor: INK, borderWidth: 1.2, color: WHITE });
  centerInBox('DAVID WANG', logoX, logoSize, logoCenterY + 3, display, 8.2);
  centerInBox('DESIGN STUDIO', logoX, logoSize, logoCenterY - 8, bold, 4);

  const titleSize = 22;
  const titleWidth = display.widthOfTextAtSize(model.config.title, titleSize);
  const logoRightEdge = logoCenterX + logoRadius;
  const titleLeftEdge = RIGHT_EDGE - titleWidth;
  const maxBlockWidth = 2 * Math.min(PAGE_CENTER_X - (logoRightEdge + 16), (titleLeftEdge - 16) - PAGE_CENTER_X);
  const fitSize = (text: string, f: any, preferred: number, measure?: (size: number) => number) => {
    let size = preferred;
    while ((measure ? measure(size) : f.widthOfTextAtSize(text, size)) > maxBlockWidth && size > 7) size -= 0.5;
    return size;
  };
  const contactWidth = (size: number) => size * 0.62 + 4 + font.widthOfTextAtSize(model.issuer.phone, size) + 10 + size * 1.25 + 4 + font.widthOfTextAtSize(model.issuer.email, size);
  const headerLines = [
    { text: LEGAL_NAME, f: display, size: fitSize(LEGAL_NAME, display, 20), gapBefore: 0 },
    { text: model.issuer.name, f: font, size: fitSize(model.issuer.name, font, 11), gapBefore: 6 },
    { text: BUSINESS_ADDRESS, f: font, size: fitSize(BUSINESS_ADDRESS, font, 9), gapBefore: 4 },
    { text: '', f: font, size: fitSize('', font, 9, contactWidth), gapBefore: 4 },
  ];
  const blockHeight = headerLines.reduce((total, line) => total + line.gapBefore + line.size * 1.3, 0);
  let headerCursor = HEADER_MID_Y + blockHeight / 2;
  headerLines.forEach((line, index) => {
    headerCursor -= line.gapBefore;
    const baseline = headerCursor - line.size * 0.8;
    if (index === 3) {
      let contactX = PAGE_CENTER_X - contactWidth(line.size) / 2;
      contactX += drawPhoneIcon(page, contactX, baseline, line.size) + 4;
      page.drawText(model.issuer.phone, { x: contactX, y: baseline, size: line.size, font, color: INK });
      contactX += font.widthOfTextAtSize(model.issuer.phone, line.size) + 10;
      contactX += drawEnvelopeIcon(page, contactX, baseline, line.size) + 4;
      page.drawText(model.issuer.email, { x: contactX, y: baseline, size: line.size, font, color: INK });
    } else page.drawText(line.text, { x: PAGE_CENTER_X - line.f.widthOfTextAtSize(line.text, line.size) / 2, y: baseline, size: line.size, font: line.f, color: INK });
    headerCursor -= line.size * 1.3;
  });

  rightText(model.config.title, RIGHT_EDGE, HEADER_MID_Y - titleSize * 0.32, display, titleSize, WALNUT);
  const headerRuleY = HEADER_TOP - HEADER_HEIGHT - 10;
  page.drawLine({ start: { x: MARGIN, y: headerRuleY }, end: { x: RIGHT_EDGE, y: headerRuleY }, thickness: 0.75, color: HAIRLINE });

  y = headerRuleY - 26;
  page.drawText('To,', { x: MARGIN, y, size: 10, font: bold, color: INK });
  rightText(`${model.numberLabel}  ${model.number}`, RIGHT_EDGE, y, bold, 9);
  y -= 16;
  page.drawText(model.client.name, { x: MARGIN, y, size: 10, font, color: INK });
  rightText(`Date: ${model.dateText}`, RIGHT_EDGE, y, font, 9, GREY);
  y -= 14;
  if (model.client.address) {
    for (const line of wrapText(model.client.address, font, 9, 290)) {
      page.drawText(line, { x: MARGIN, y, size: 9, font, color: GREY });
      y -= 12;
    }
  }
  if (model.client.phone) {
    const iconWidth = drawPhoneIcon(page, MARGIN, y, 8);
    page.drawText(model.client.phone, { x: MARGIN + iconWidth + 4, y, size: 9, font, color: GREY });
    y -= 13;
  }
  if (model.client.email) {
    const iconWidth = drawEnvelopeIcon(page, MARGIN, y, 8);
    page.drawText(model.client.email, { x: MARGIN + iconWidth + 4, y, size: 9, font, color: GREY });
    y -= 13;
  }
  if (model.config.showValidUntil && model.validUntilText) rightText(`Valid until: ${model.validUntilText}`, RIGHT_EDGE, headerRuleY - 58, font, 9, GREY);
  y -= 8;
  page.drawText('Dear Sir/Madam,', { x: MARGIN, y, size: 10, font, color: INK });
  y -= 17;
  page.drawText(model.config.intro, { x: MARGIN, y, size: 9.5, font, color: INK });
  y -= 27;
  drawTableHeader();

  let lastSeparatorY = y;
  if (model.rows.length === 0) {
    const rowHeight = ROW_PAD_TOP + NAME_LINE_H + ROW_PAD_BOTTOM;
    if (y - rowHeight < BOTTOM_LIMIT) {
      newContinuationPage();
      drawTableHeader();
    }
    const rowTop = y;
    const textY = rowTop - ROW_PAD_TOP - NAME_SIZE * 0.8;
    page.drawText(model.emptyRowsText, { x: DESCRIPTION_X, y: textY, size: 9, font, color: GREY });
    y = rowTop - rowHeight;
    dotted(y);
    lastSeparatorY = y;
  }

  model.rows.forEach((row, index) => {
    const nameLines = wrapText(row.name, bold, NAME_SIZE, DESCRIPTION_WIDTH);
    const specifications = row.extraLine ?? [
      row.material ? `Material: ${row.material}` : '', row.colour ? `Colour: ${row.colour}` : '',
      row.measurements ? `Measurements: ${row.measurements}` : '', row.customRequirements ? `Custom requirements: ${row.customRequirements}` : '', row.discount && row.discount > 0 ? `Discount: -${formatMoney(row.discount, model.currency)}` : '',
    ].filter(Boolean).join(' | ');
    const specLines = specifications ? wrapText(specifications, font, 8, DESCRIPTION_WIDTH) : [];
    const rowHeight = ROW_PAD_TOP + nameLines.length * NAME_LINE_H + specLines.length * SPEC_LINE_H + ROW_PAD_BOTTOM;
    if (y - rowHeight < BOTTOM_LIMIT) {
      newContinuationPage();
      drawTableHeader();
    }
    const rowTop = y;
    const textY = rowTop - ROW_PAD_TOP - NAME_SIZE * 0.8;
    page.drawText(String(index + 1), { x: MARGIN + PAD, y: textY, size: 9, font, color: INK });
    nameLines.forEach((line, lineIndex) => page.drawText(line, { x: DESCRIPTION_X, y: textY - lineIndex * NAME_LINE_H, size: NAME_SIZE, font: bold, color: INK }));
    const specY = textY - nameLines.length * NAME_LINE_H;
    specLines.forEach((line, lineIndex) => page.drawText(line, { x: DESCRIPTION_X, y: specY - lineIndex * SPEC_LINE_H, size: 8, font, color: GREY }));
    const unitPriceCents = toCents(row.unitPrice);
    const lineTotalCents = unitPriceCents * Number(row.quantity) - toCents(row.discount ?? 0);
    rightText(String(row.quantity), QTY_RIGHT, textY, font, 9);
    rightMoney(formatCents(unitPriceCents), PRICE_RIGHT, textY, font, 9, PRICE_RIGHT - QTY_RIGHT - 8);
    rightMoney(formatCents(lineTotalCents), VALUE_RIGHT, textY, font, 9, VALUE_RIGHT - PRICE_RIGHT - 8);
    y = rowTop - rowHeight;
    dotted(y);
    lastSeparatorY = y;
  });

  const printableTerms = usingFallbackFonts ? TERMS.map((term) => term.replaceAll('’', "'").replaceAll('–', '-')) : TERMS;
  const termLines = model.config.showTerms ? printableTerms.flatMap((term, index) => wrapText(`${index + 1}. ${term}`, font, 8, 290)) : [];
  const paymentX = model.config.showTerms ? MARGIN + 324 : MARGIN;
  const paymentColumnWidth = RIGHT_EDGE - paymentX;
  const paymentBlocks = model.config.showPayment
    ? PAYMENT_INSTRUCTIONS_BLOCKS.map((block) => ({
      country: block.country,
      lines: block.lines.flatMap((line) => wrapText(line, font, 8, paymentColumnWidth)),
    }))
    : [];
  const measureFooter = () => {
    const termsHeight = model.config.showTerms ? 14 + termLines.length * 10.5 : 0;
    const paymentHeight = model.config.showPayment
      ? 14 + paymentBlocks.reduce((height, block) => height + 10 + block.lines.length * 10 + 6, 0)
      : 0;
    return FOOTER_GAP_TOP + (model.config.closing ? 20 : 0) + Math.max(termsHeight, paymentHeight, 0) + 88;
  };

  const totals = model.type === 'receipt'
    && model.totals.receipt
    && model.totals.receipt.orderTotal == null
    && model.totals.receipt.balanceRemaining == null
    ? { lines: [], band: { label: 'TOTAL PAID', cents: model.totals.receipt.totalPaid } }
    : model.totals;
  const totalLines = totals.discount && totals.discount > 0
    ? [totals.lines[0], { label: 'DISCOUNT', cents: -toCents(totals.discount) }, ...totals.lines.slice(1)]
    : totals.lines;
  const totalsHeight = TOTALS_GAP_TOP + totalLines.length * TOTALS_ROW_H + TOTALS_GAP_BAND + GT_ROW_H;
  let totalsTopY = lastSeparatorY;
  if (totalsTopY - totalsHeight < BOTTOM_LIMIT) {
    newContinuationPage();
    totalsTopY = y;
  }
  const totalsX = 345;
  const drawTotal = (label: string, value: string, yy: number, isBand = false, size?: number) => {
    const selectedFont = isBand ? bold : font;
    const textSize = size ?? (isBand ? 10 : 9);
    page.drawText(label, { x: totalsX, y: yy, size: textSize, font: selectedFont, color: isBand ? WALNUT : INK });
    rightMoney(value, VALUE_RIGHT, yy, selectedFont, textSize, VALUE_RIGHT - totalsX - 80, isBand ? WALNUT : INK);
  };
  let normalBaseline = totalsTopY - TOTALS_GAP_TOP;
  totalLines.forEach((line) => {
    drawTotal(line.label, formatTotal(line.cents), normalBaseline);
    normalBaseline -= TOTALS_ROW_H;
  });
  const bandTop = normalBaseline - TOTALS_GAP_BAND;
  const bandBottom = bandTop - GT_ROW_H;
  let bandSize = 10;
  while (bold.widthOfTextAtSize(totals.band.label, bandSize) + bold.widthOfTextAtSize(formatTotal(totals.band.cents), bandSize) + 14 > VALUE_RIGHT - totalsX && bandSize > 8) bandSize -= 0.5;
  page.drawRectangle({ x: totalsX - PAD, y: bandBottom, width: RIGHT_EDGE - (totalsX - PAD), height: GT_ROW_H, color: TINT });
  page.drawLine({ start: { x: totalsX - PAD, y: bandTop }, end: { x: RIGHT_EDGE, y: bandTop }, thickness: 0.9, color: RULE_STRONG });
  drawTotal(totals.band.label, formatTotal(totals.band.cents), centredBaseline(bandBottom, GT_ROW_H, bandSize), true, bandSize);
  page.drawLine({ start: { x: totalsX - PAD, y: bandBottom }, end: { x: RIGHT_EDGE, y: bandBottom }, thickness: 0.9, color: RULE_STRONG });

  const footerFitsHere = bandBottom - measureFooter() >= BOTTOM_LIMIT;
  if (!footerFitsHere) {
    if (model.config.lastPageNote) {
      const noteWidth = (totalsX - PAD) - MARGIN - 16;
      let noteY = totalsTopY - TOTALS_GAP_TOP;
      wrapText(model.config.lastPageNote, font, 8.5, noteWidth).forEach((line) => {
        page.drawText(line, { x: MARGIN, y: noteY, size: 8.5, font, color: WALNUT });
        noteY -= 11;
      });
    }
    newContinuationPage();
  } else y = bandBottom - FOOTER_GAP_TOP;

  if (model.config.closing) {
    page.drawText(model.config.closing, { x: MARGIN, y, size: 9.5, font, color: INK });
    y -= 20;
  }
  const footerTop = y;
  if (model.config.showTerms) page.drawText('TERMS & CONDITIONS:', { x: MARGIN, y: footerTop, size: 9, font: bold, color: WALNUT });
  if (model.config.showPayment) page.drawText('PAYMENT INSTRUCTIONS', { x: paymentX, y: footerTop, size: 9, font: bold, color: WALNUT });
  let termsY = footerTop - 14;
  termLines.forEach((line) => {
    page.drawText(line, { x: MARGIN, y: termsY, size: 8, font, color: GREY });
    termsY -= 10.5;
  });
  let paymentY = footerTop - 14;
  paymentBlocks.forEach((block) => {
    page.drawText(block.country, { x: paymentX, y: paymentY, size: 8, font: bold, color: INK });
    paymentY -= 10;
    block.lines.forEach((line) => {
      page.drawText(line, { x: paymentX, y: paymentY, size: 8, font, color: GREY });
      paymentY -= 10;
    });
    paymentY -= 6;
  });
  const signatureY = Math.min(model.config.showTerms ? termsY : footerTop, model.config.showPayment ? paymentY : footerTop) - 18;
  rightText(`For, ${LEGAL_NAME.toUpperCase()}`, RIGHT_EDGE, signatureY, bold, 9);
  if (signatureImage) {
    const signatureWidth = 120;
    const signatureHeight = (signatureImage.height / signatureImage.width) * signatureWidth;
    page.drawImage(signatureImage, { x: RIGHT_EDGE - signatureWidth, y: signatureY - 54, width: signatureWidth, height: signatureHeight });
  }
  rightText('AUTHORIZED SIGNATURE', RIGHT_EDGE, signatureY - 66, font, 8, GREY);

  return pdfDoc.save();
}
