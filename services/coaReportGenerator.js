const path = require('path');
const fs = require('fs/promises');
const fetch = require('node-fetch');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  PageBreak,
  HeadingLevel,
  ImageRun
} = require('docx');

const A4_PAGE = { width: 11906, height: 16838 };
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

function cell(text, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGINS,
    shading: options.shaded
      ? { fill: 'E5E7EB', type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
    children: [
      new Paragraph({
        alignment: options.align || AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text ?? '',
            bold: Boolean(options.bold),
            color: options.color
          })
        ]
      })
    ]
  });
}

async function readImageBufferFromUrl(url, backendRoot) {
  if (!url) return null;
  if (url.startsWith('/uploads/') || url.startsWith('/reports/')) {
    const localPath = path.join(backendRoot, url.replace(/^\//, ''));
    return fs.readFile(localPath);
  }
  const response = await fetch(url);
  if (!response.ok) return null;
  const ab = await response.arrayBuffer();
  return Buffer.from(ab);
}

function imageTypeFromPath(p = '') {
  const lower = p.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  return 'jpg';
}

function buildHeaderTable(leftLogo, rightLogo) {
  return new Table({
    width: { size: 10000, type: WidthType.DXA },
    columnWidths: [2500, 5000, 2500],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2500, type: WidthType.DXA },
            margins: CELL_MARGINS,
            children: [new Paragraph({ children: leftLogo ? [leftLogo] : [new TextRun(' ')] })]
          }),
          new TableCell({
            width: { size: 5000, type: WidthType.DXA },
            margins: CELL_MARGINS,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                heading: HeadingLevel.HEADING_1,
                children: [new TextRun({ text: 'CERTIFICATE OF ANALYSIS (CoA)', bold: true })]
              })
            ]
          }),
          new TableCell({
            width: { size: 2500, type: WidthType.DXA },
            margins: CELL_MARGINS,
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: rightLogo ? [rightLogo] : [new TextRun(' ')] })]
          })
        ]
      })
    ]
  });
}

function makePhotoRow(photos) {
  if (!photos?.length) {
    return new Paragraph({ children: [new TextRun('Photo evidence not available.')] });
  }
  const size = photos.length === 1 ? { width: 360, height: 220 } : photos.length === 2 ? { width: 250, height: 160 } : { width: 170, height: 120 };
  return new Table({
    width: { size: 10000, type: WidthType.DXA },
    columnWidths: photos.map(() => Math.floor(10000 / photos.length)),
    rows: [
      new TableRow({
        children: photos.map((img) =>
          new TableCell({
            width: { size: Math.floor(10000 / photos.length), type: WidthType.DXA },
            margins: CELL_MARGINS,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: img.buffer,
                    type: img.type,
                    transformation: size
                  })
                ]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: img.label || `Photo ${img.slot}`, size: 18 })]
              })
            ]
          })
        )
      })
    ]
  });
}

async function buildCoaDocBuffer(data) {
  const backendRoot = path.resolve(__dirname, '..');
  const frontendPublic = path.resolve(backendRoot, '..', 'frontend', 'public');
  const leftLogoPath = path.join(frontendPublic, 'report_logo.png');
  const rightLogoPath = path.join(frontendPublic, 'report logo.png');
  const midLogoPath = path.join(frontendPublic, 'report mid logo.png');

  const [leftLogoBufferRaw, rightLogoBuffer, midLogoBuffer] = await Promise.all([
    fs.readFile(leftLogoPath).catch(() => null),
    fs.readFile(rightLogoPath).catch(() => null),
    fs.readFile(midLogoPath).catch(() => null)
  ]);
  const leftLogoBuffer = leftLogoBufferRaw || rightLogoBuffer;

  const leftLogo = leftLogoBuffer
    ? new ImageRun({ data: leftLogoBuffer, type: 'png', transformation: { width: 110, height: 80 } })
    : null;
  const rightLogo = rightLogoBuffer
    ? new ImageRun({ data: rightLogoBuffer, type: 'png', transformation: { width: 110, height: 100 } })
    : null;
  const midLogo = midLogoBuffer
    ? new ImageRun({ data: midLogoBuffer, type: 'png', transformation: { width: 430, height: 200 } })
    : null;

  const photoEntries = Array.isArray(data.result_data?.photos) ? data.result_data.photos : [];
  const embeddedPhotos = [];
  for (const p of photoEntries.slice(0, 3)) {
    try {
      const buffer = await readImageBufferFromUrl(p.url, backendRoot);
      if (buffer) embeddedPhotos.push({ buffer, type: imageTypeFromPath(p.url), label: p.label, slot: p.slot });
    } catch {
      // Gracefully skip failed image fetches.
    }
  }

  const detailsTable = new Table({
    width: { size: 10000, type: WidthType.DXA },
    columnWidths: [1700, 3300, 2000, 3000],
    rows: [
      new TableRow({
        children: [
          cell('Product Name', 1700, { bold: true }),
          cell(data.article_name || '', 3300),
          cell('REPORT/TESTNAME.', 2000, { bold: true }),
          cell(`${data.report_number || ''} ${String(data.test_name || '').toUpperCase()}`, 3000)
        ]
      }),
      new TableRow({
        children: [
          cell('ARTICLE NO.', 1700, { bold: true }),
          cell(data.article_number || '', 3300),
          cell('Date', 2000, { bold: true }),
          cell(data.submitted_date || '', 3000)
        ]
      }),
      new TableRow({
        children: [
          cell('SOLE', 1700, { bold: true }),
          cell(`${data.material_type || ''} ${data.color || ''}`.trim(), 3300),
          cell('CUSTOMER', 2000, { bold: true }),
          cell(data.client_code || '', 3000)
        ]
      })
    ]
  });

  const paramsTable = new Table({
    width: { size: 10000, type: WidthType.DXA },
    columnWidths: [3333, 3333, 3334],
    rows: [
      new TableRow({
        children: [
          cell('TESTING PARAMETERS', 3333, { bold: true, shaded: true, align: AlignmentType.CENTER }),
          cell('STANDARD PARAMETERS', 3333, { bold: true, shaded: true, align: AlignmentType.CENTER }),
          cell('RESULTS', 3334, { bold: true, shaded: true, align: AlignmentType.CENTER })
        ]
      }),
      new TableRow({ children: [cell('TESTING METHOD', 3333, { bold: true }), cell(data.test_standard || '', 3333), cell(data.test_standard || '', 3334)] }),
      new TableRow({ children: [cell('CLIENT SPECIFICATION', 3333, { bold: true }), cell(data.client_requirement || '', 3333), cell(data.result_data?.calculated_results?.result ?? data.result ?? '', 3334)] })
    ]
  });

  const resultTable = new Table({
    width: { size: 10000, type: WidthType.DXA },
    columnWidths: [2500, 7500],
    rows: [
      new TableRow({
        children: [
          cell('RESULT', 2500, { bold: true }),
          cell(data.result || '', 7500, {
            bold: true,
            color: data.result === 'PASS' ? '15803D' : 'B91C1C'
          })
        ]
      })
    ]
  });

  const signatureTable = new Table({
    width: { size: 10000, type: WidthType.DXA },
    columnWidths: [2000, 2000, 2000, 2000, 2000],
    rows: [
      new TableRow({
        children: [
          cell('Tested By\nSenior Lab Analyst', 2000),
          cell('Reviewed By\nQuality Assurance Manager', 2000),
          cell('Reviewed By\nProduct Manager / QA Manager', 2000),
          cell('Approved By (L1)\nManagement Approval Level 1', 2000),
          cell('Approved By (L2)\nManagement Approval Level 2', 2000)
        ]
      })
    ]
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: { size: A4_PAGE }
        },
        children: [
          buildHeaderTable(leftLogo, rightLogo),
          new Paragraph({}),
          detailsTable,
          new Paragraph({}),
          paramsTable,
          new Paragraph({}),
          ...(midLogo ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [midLogo] })] : []),
          new Paragraph({}),
          makePhotoRow(embeddedPhotos),
          new Paragraph({}),
          resultTable,
          new Paragraph({}),
          signatureTable,
          new Paragraph({
            children: [
              new TextRun({
                text: 'This Certificate of Analysis is issued for informational purposes only. Please read the disclaimer on the reverse page before use.',
                italics: true,
                size: 18
              })
            ]
          }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'DISCLAIMER', bold: true })] }),
          new Paragraph({
            children: [
              new TextRun(
                'This Certificate of Analysis ("CoA") has been prepared by VIROLA ASSURE LABS under controlled laboratory conditions for internal quality control purposes. The information, results, findings, and observations provided herein are generated solely for internal quality control purposes and are intended strictly for informational reference only.'
              )
            ]
          }),
          new Paragraph({ children: [new TextRun({ text: 'Non-Warranty Statement', bold: true })] }),
          new Paragraph({ children: [new TextRun('No express or implied warranties are provided for this CoA, including fitness for a particular purpose, merchantability, or accuracy.')]}),
          new Paragraph({ children: [new TextRun({ text: 'Scope Limitation', bold: true })] }),
          new Paragraph({ children: [new TextRun('The results pertain exclusively to tested samples and cannot be assumed to represent any broader product lot or batch conditions.')] }),
          new Paragraph({ children: [new TextRun({ text: 'Independent Verification', bold: true })] }),
          new Paragraph({ children: [new TextRun('Recipients are strongly advised to conduct independent testing and verification prior to relying upon this report.')] }),
          new Paragraph({ children: [new TextRun({ text: 'Limitation of Liability', bold: true })] }),
          new Paragraph({ children: [new TextRun('VIROLA ASSURE LABS shall not be liable for any direct, indirect, incidental, special, or consequential damages resulting from use or reliance on this CoA.')] }),
          new Paragraph({ children: [new TextRun({ text: 'No Endorsement or Certification', bold: true })] }),
          new Paragraph({ children: [new TextRun('This document does not represent endorsement, approval, or certification by VIROLA ASSURE LABS of any material, supplier, or product.')] }),
          new Paragraph({ children: [new TextRun({ text: 'Indemnity', bold: true })] }),
          new Paragraph({ children: [new TextRun('The recipient agrees to indemnify and hold harmless VIROLA ASSURE LABS from claims arising from misuse of this CoA.')] }),
          new Paragraph({ children: [new TextRun({ text: 'Jurisdiction', bold: true })] }),
          new Paragraph({ children: [new TextRun('Any disputes arising from this CoA shall be subject to the exclusive jurisdiction of competent courts at Kolkata, India.')] }),
          new Paragraph({ children: [new TextRun({ text: 'Internal Use Emphasis', bold: true })] }),
          new Paragraph({ children: [new TextRun('This document is strictly intended for internal quality control purposes and is not to be construed as an externally binding certification.')] }),
          new Paragraph({ children: [new TextRun({ text: 'Important Notice', bold: true })] }),
          new Paragraph({ children: [new TextRun('By accepting, viewing, or using this CoA, you acknowledge and agree to the above terms and limitations.')] })
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}

module.exports = {
  buildCoaDocBuffer
};
