const PDFDocument = require('pdfkit');
const Sale = require('../models/Sale');
const Media = require('../models/Media');
const money = value => new Intl.NumberFormat('en-TZ', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value));
exports.generate = async id => {
  const sale = await Sale.find(id),
    profile = sale.pharmacy_profile || {};
  const logoId = profile.invoice_show_logo !== 0 && Media.idFromUrl(profile.logo_url);
  const logo = logoId ? await Media.find(logoId) : null;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    bufferPages: true,
    info: {
      Title: sale.invoice_number,
      Author: profile.pharmacy_name || 'Pharmacy'
    }
  });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const left = 42,
    right = 553,
    width = 511,
    green = '#157347',
    gray = '#56616b';
  const text = (value, x, y, options = {}) => doc.text(String(value ?? ''), x, y, options);
  const rule = y => doc.strokeColor('#dce5df').moveTo(left, y).lineTo(right, y).stroke();
  let y = 42;
  doc.rect(0, 0, 595, 10).fill(green);
  if (logo) doc.image(logo.content, left, y, {
    fit: [60, 60]
  });
  const brandX = logo ? 116 : left;
  doc.font('Helvetica-Bold').fontSize(19).fillColor(green);
  text(profile.pharmacy_name || 'Pharmacy', brandX, y, {
    width: right - brandX
  });
  y = doc.y + 8;
  doc.font('Helvetica').fontSize(9).fillColor(gray);
  for (const line of [profile.address, [profile.phone, profile.email].filter(Boolean).join(' | '), profile.registration_number && 'Registration: ' + profile.registration_number, profile.website, profile.business_hours]) {
    if (line) {
      text(line, brandX, y, {
        width: right - brandX
      });
      y = doc.y + 3;
    }
  }
  y = Math.max(y, 110) + 16;
  rule(y);
  y += 18;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(green);
  text(profile.invoice_title || 'SALES INVOICE', left, y, {
    width: width - 90
  });
  const titleBottom = doc.y;
  doc.roundedRect(right - 70, y - 2, 70, 24, 5).fill('#e6f4eb');
  doc.fontSize(10).fillColor(green);
  text('PAID', right - 70, y + 5, {
    width: 70,
    align: 'center'
  });
  y = Math.max(titleBottom, doc.y) + 20;
  doc.font('Helvetica').fontSize(10).fillColor('#18232d');
  for (const line of ['Invoice: ' + sale.invoice_number, 'Date: ' + sale.sale_date, 'Customer: ' + (sale.customer_name || 'Walk-in customer'), 'Served by: ' + sale.staff, 'Payment: ' + sale.payment_method.replaceAll('_', ' ')]) {
    text(line, left, y, {
      width
    });
    y = doc.y + 5;
  }
  y += 14;
  const header = () => {
    doc.rect(left, y, width, 25).fill(green);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('white');
    text('MEDICINE / BATCH', left + 8, y + 8, {
      width: 230
    });
    text('QTY', 296, y + 8, {
      width: 40,
      align: 'right'
    });
    text('UNIT (TZS)', 340, y + 8, {
      width: 95,
      align: 'right'
    });
    text('AMOUNT (TZS)', 440, y + 8, {
      width: 105,
      align: 'right'
    });
    y += 25;
  };
  const page = () => {
    doc.addPage();
    y = 42;
    doc.fontSize(9).font('Helvetica').fillColor(gray);
    text(sale.invoice_number + ' · continued', left, y, {
      width
    });
    y += 22;
  };
  if (y > 640) page();
  header();
  for (const [index, item] of sale.items.entries()) {
    doc.font('Helvetica').fontSize(10);
    const name = item.medicine_name + '\nBatch: ' + item.batch_number;
    const height = Math.max(40, doc.heightOfString(name, {
      width: 232
    }) + 16);
    if (y + height > 745) {
      page();
      header();
    }
    if (index % 2 === 0) doc.rect(left, y, width, height).fill('#f4f8f5');
    doc.fillColor('#18232d');
    text(name, left + 8, y + 8, {
      width: 232
    });
    text(item.quantity, 296, y + 8, {
      width: 40,
      align: 'right'
    });
    text(money(item.unit_price), 340, y + 8, {
      width: 95,
      align: 'right'
    });
    text(money(item.subtotal), 440, y + 8, {
      width: 105,
      align: 'right'
    });
    y += height;
    rule(y);
  }
  if (y + 190 > 745) page();
  y += 18;
  for (const [label, value, strong] of [['Subtotal', sale.subtotal], ['Discount', sale.discount], ['TOTAL (TZS)', sale.total_amount, true], ['Amount paid', sale.amount_paid], ['Change', sale.change_amount]]) {
    if (strong) doc.rect(300, y - 5, 253, 28).fill('#e6f4eb');
    doc.fillColor(strong ? green : '#18232d').font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 12 : 10);
    text(label, 308, y, {
      width: 125
    });
    text(money(value), 430, y, {
      width: 115,
      align: 'right'
    });
    y += strong ? 36 : 24;
  }
  for (const section of [profile.invoice_terms, profile.invoice_footer]) {
    if (!section) continue;
    doc.font('Helvetica').fontSize(9);
    const height = doc.heightOfString(section, {
      width
    }) + 20;
    if (y + height > 745) page();
    y += 10;
    doc.fillColor(gray);
    text(section, left, y, {
      width
    });
    y = doc.y + 10;
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    rule(779);
    doc.font('Helvetica').fontSize(8).fillColor(gray);
    text(sale.invoice_number, left, 787, {
      width: 360,
      lineBreak: false
    });
    text('Page ' + (i + 1) + ' of ' + range.count, 455, 787, {
      width: 98,
      align: 'right',
      lineBreak: false
    });
  }
  doc.end();
  return {
    buffer: await complete,
    filename: sale.invoice_number.replace(/[^A-Za-z0-9_-]/g, '_') + '.pdf'
  };
};
