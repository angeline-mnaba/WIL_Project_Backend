import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CREAM = rgb(0.973, 0.961, 0.937);
const INK = rgb(0.090, 0.078, 0.059);
const WALNUT_DEEP = rgb(0.231, 0.165, 0.122);
const WALNUT = rgb(0.420, 0.290, 0.208);
const WALNUT_LIGHT = rgb(0.937, 0.902, 0.867);
const OLIVE = rgb(0.420, 0.478, 0.247);
const OLIVE_DEEP = rgb(0.310, 0.361, 0.173);
const HERO_LABEL_TAN = rgb(0.796, 0.722, 0.604);

// Stable Google Fonts TTF files copied from generate-document.
// Display: Lora Bold. Body: Work Sans Regular/Bold.
const DISPLAY_FONT_URL = 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vCJG.ttf';
const BODY_FONT_URL = 'https://fonts.gstatic.com/s/worksans/v24/QGY_z_wNahGAdqQ43RhVcIgYT2Xz5u32K0nXNig.ttf';
const BODY_BOLD_FONT_URL = 'https://fonts.gstatic.com/s/worksans/v24/QGY_z_wNahGAdqQ43RhVcIgYT2Xz5u32K67QNig.ttf';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }

  if (current) lines.push(current);
  return lines;
}

async function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load font: ${url}`);
  return response.arrayBuffer();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: 'Not authenticated.' }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: staffRow, error: staffError } = await adminClient
      .from('staff_users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (staffError || !staffRow) {
      return jsonResponse({ error: 'Not authorized.' }, 403);
    }

    const body = await req.json();
    const { jobCardId, canvasImageBase64 } = body;

    if (!jobCardId) {
      return jsonResponse({ error: 'Missing jobCardId.' }, 400);
    }

    const { data: card, error: cardError } = await adminClient
      .from('job_cards')
      .select('*, orders(order_number)')
      .eq('id', jobCardId)
      .maybeSingle();

    if (cardError || !card) {
      return jsonResponse({ error: 'Job card not found.' }, 404);
    }

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    let display;
    let font;
    let bold;

    try {
      const [displayBytes, bodyBytes, bodyBoldBytes] = await Promise.all([
        fetchFontBytes(DISPLAY_FONT_URL),
        fetchFontBytes(BODY_FONT_URL),
        fetchFontBytes(BODY_BOLD_FONT_URL),
      ]);
      display = await pdfDoc.embedFont(displayBytes);
      font = await pdfDoc.embedFont(bodyBytes);
      bold = await pdfDoc.embedFont(bodyBoldBytes);
    } catch {
      display = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    const HERO_HEIGHT = 118;
    const BODY_TOP = PAGE_HEIGHT - HERO_HEIGHT;
    const LABEL_SIZE = 7;
    const DETAIL_SIZE = 9;

    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: CREAM });
    page.drawRectangle({ x: 0, y: BODY_TOP, width: PAGE_WIDTH, height: HERO_HEIGHT, color: WALNUT_DEEP });

    page.drawText('DAVID WANG CUSTOM FURNITURE', {
      x: MARGIN,
      y: PAGE_HEIGHT - 34,
      size: 9,
      font: bold,
      color: HERO_LABEL_TAN,
    });
    page.drawText('Job Card', {
      x: MARGIN,
      y: PAGE_HEIGHT - 68,
      size: 28,
      font: display,
      color: rgb(1, 1, 1),
    });
    const orderLine = card.orders?.order_number ? `Linked order: ${card.orders.order_number}` : 'Not linked to an order';
    page.drawText(orderLine, {
      x: MARGIN,
      y: PAGE_HEIGHT - 100,
      size: 9,
      font,
      color: WALNUT_LIGHT,
    });

    const canvasCutoffY = MARGIN + (BODY_TOP - MARGIN) * 0.75;

    const colGutter = 24;
    const colWidth = (CONTENT_WIDTH - colGutter) / 2;
    const leftX = MARGIN;
    const rightX = MARGIN + colWidth + colGutter;

    const drawLabel = (label: string, x: number, y: number) => {
      page.drawText(label, { x, y, size: LABEL_SIZE, font: bold, color: OLIVE_DEEP });
    };

    let y = BODY_TOP - 28;
    let leftY = y;
    drawLabel('CLIENT', leftX, leftY);
    leftY -= 14;
    page.drawText(card.client_name ?? 'N/A', { x: leftX, y: leftY, size: 11, font: bold, color: INK });
    leftY -= 14;
    if (card.client_phone) {
      page.drawText(card.client_phone, { x: leftX, y: leftY, size: DETAIL_SIZE, font, color: WALNUT });
      leftY -= 12;
    }
    if (card.client_email) {
      page.drawText(card.client_email, { x: leftX, y: leftY, size: DETAIL_SIZE, font, color: WALNUT });
      leftY -= 12;
    }

    let rightY = y;
    drawLabel('PRODUCTION', rightX, rightY);
    rightY -= 14;
    page.drawText(`Completion: ${card.estimated_completion_date ?? 'TBC'}`, {
      x: rightX,
      y: rightY,
      size: 11,
      font: bold,
      color: WALNUT,
    });
    rightY -= 14;
    if (card.fabric) {
      page.drawText(`Fabric: ${card.fabric}`, { x: rightX, y: rightY, size: DETAIL_SIZE, font, color: INK });
      rightY -= 12;
    }
    if (card.colour) {
      page.drawText(`Colour: ${card.colour}`, { x: rightX, y: rightY, size: DETAIL_SIZE, font, color: INK });
      rightY -= 12;
    }
    if (card.dimensions) {
      page.drawText(`Dimensions: ${card.dimensions}`, { x: rightX, y: rightY, size: DETAIL_SIZE, font, color: INK });
      rightY -= 12;
    }

    y = Math.min(leftY, rightY) - 6;

    const bodySize = 8.5;
    const lineHeight = 11;
    if (card.design) {
      const lines = wrapText(`Design: ${card.design}`, font, bodySize, CONTENT_WIDTH);
      lines.forEach((line) => {
        page.drawText(line, { x: MARGIN, y, size: bodySize, font, color: INK });
        y -= lineHeight;
      });
    }
    if (card.customisation_details) {
      const lines = wrapText(`Customisation: ${card.customisation_details}`, font, bodySize, CONTENT_WIDTH);
      lines.forEach((line) => {
        page.drawText(line, { x: MARGIN, y, size: bodySize, font, color: INK });
        y -= lineHeight;
      });
    }

    const sketchTopY = Math.min(y - 10, canvasCutoffY);
    drawLabel('SKETCH / REFERENCE BOARD', MARGIN, sketchTopY);
    const frameTopY = sketchTopY - 16;
    const frameInset = 8;
    const maxFrameHeight = frameTopY - MARGIN;

    if (canvasImageBase64) {
      const availableWidth = CONTENT_WIDTH - frameInset * 2;
      const availableHeight = maxFrameHeight - frameInset * 2;

      try {
        if (availableHeight < 40) {
          throw new Error('Not enough room for sketch board image.');
        }

        const encoded = canvasImageBase64.split(',').pop() ?? '';
        const imageBytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const isJpeg = canvasImageBase64.startsWith('data:image/jpeg');
        const embeddedImage = isJpeg ? await pdfDoc.embedJpg(imageBytes) : await pdfDoc.embedPng(imageBytes);

        const scale = Math.min(availableWidth / embeddedImage.width, availableHeight / embeddedImage.height);
        const drawWidth = embeddedImage.width * scale;
        const drawHeight = embeddedImage.height * scale;
        const drawX = MARGIN + (CONTENT_WIDTH - drawWidth) / 2;
        const drawY = MARGIN + (frameTopY - MARGIN - drawHeight) / 2;

        page.drawRectangle({
          x: drawX - frameInset,
          y: drawY - frameInset,
          width: drawWidth + frameInset * 2,
          height: drawHeight + frameInset * 2,
          color: WALNUT_LIGHT,
          borderColor: WALNUT,
          borderWidth: 1,
        });
        page.drawRectangle({
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
          color: rgb(1, 1, 1),
        });
        page.drawImage(embeddedImage, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
      } catch {
        page.drawText('(Could not embed the sketch board image.)', {
          x: MARGIN,
          y: frameTopY - 24,
          size: 9,
          font,
          color: WALNUT,
        });
      }
    } else {
      page.drawRectangle({
        x: MARGIN,
        y: MARGIN + 28,
        width: CONTENT_WIDTH,
        height: Math.max(60, maxFrameHeight - 28),
        color: WALNUT_LIGHT,
        borderColor: WALNUT,
        borderWidth: 1,
      });
      page.drawText('No sketch content on this job card yet.', {
        x: MARGIN + 18,
        y: Math.max(MARGIN + 52, frameTopY - 40),
        size: 10,
        font,
        color: WALNUT,
      });
    }

    page.drawText(`Generated ${new Date().toLocaleDateString()}`, {
      x: MARGIN,
      y: 18,
      size: 7,
      font,
      color: OLIVE,
    });

    const pdfBytes = await pdfDoc.save();
    const filenameName = String(card.client_name ?? 'job-card')
      .trim()
      .replace(/[^a-z0-9-_\s]/gi, '')
      .replace(/\s+/g, '-')
      .toLowerCase() || 'job-card';

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="job-card-${filenameName}.pdf"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    return jsonResponse({ error: message }, 500);
  }
});
