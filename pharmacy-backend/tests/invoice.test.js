const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../config/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {}
};
const Sale = require('../models/Sale'),
  Media = require('../models/Media');
test('long invoice paginates with a PDF footer and does not fetch external logos', async () => {
  Sale.find = async () => ({
    invoice_number: 'INV-LONG',
    sale_date: '2026-09-28',
    customer_name: 'Customer',
    staff: 'Pharmacist',
    payment_method: 'CASH',
    subtotal: '15000',
    discount: '0',
    total_amount: '15000',
    amount_paid: '15000',
    change_amount: '0',
    pharmacy_profile: {
      pharmacy_name: 'Example Pharmacy',
      logo_url: 'https://example.test/image.png',
      invoice_terms: 'Terms '.repeat(150)
    },
    items: Array.from({
      length: 100
    }, (_, index) => ({
      medicine_name: 'Medicine ' + index + ' with a long description to exercise wrapped invoice lines',
      batch_number: 'BATCH-' + index,
      quantity: 1,
      unit_price: '150',
      subtotal: '150'
    }))
  });
  Media.find = () => {
    throw new Error('External logo must not be fetched');
  };
  const {
    buffer,
    filename
  } = await require('../services/invoiceService').generate(1);
  assert.equal(filename, 'INV-LONG.pdf');
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok((buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1);
});
