const {
  integer,
  text,
  price,
  fail
} = require('./catalog');
function object(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A JSON object is required.');
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(`Unexpected field: ${key}.`);
}
function today() {
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
}
function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') fail(`${name} must be a valid date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${name} must be a valid date.`);
  return value;
}
function cents(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function decimal(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
function supplier(input, editing = false) {
  object(input, ['name', 'company', 'phone', 'email', 'address', 'registration_number', 'contact_person', 'notes', ...(editing ? ['version'] : [])]);
  const data = {
    name: text(input.name, 'Supplier name', 150, true)
  };
  for (const [key, limit] of Object.entries({
    company: 150,
    phone: 30,
    email: 150,
    address: 2000,
    registration_number: 100,
    contact_person: 150,
    notes: 5000
  })) data[key] = text(input[key], key.replaceAll('_', ' '), limit);
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('Enter a valid supplier email.');
  if (data.email) data.email = data.email.toLowerCase();
  if (editing) data.version = integer(input.version, 'Version', 1);
  return data;
}
function purchase(input) {
  object(input, ['supplier_id', 'purchase_date', 'invoice_number', 'notes', 'amount_paid', 'request_key', 'items']);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_key)) fail('A valid request key is required.');
  const data = {
    supplier_id: integer(input.supplier_id, 'Supplier', 1),
    purchase_date: date(input.purchase_date, 'Purchase date'),
    invoice_number: text(input.invoice_number, 'Invoice number', 100, true),
    notes: text(input.notes, 'Notes', 5000),
    request_key: input.request_key.toLowerCase()
  };
  if (data.purchase_date > today()) fail('Purchase date cannot be in the future.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail('A purchase needs between 1 and 100 items.');
  const seen = new Set();
  const sellingPrices = new Map();
  let total = 0n;
  data.items = input.items.map(item => {
    object(item, ['medicine_id', 'batch_number', 'quantity', 'purchase_price', 'selling_price', 'expiry_date']);
    const parsed = {
      medicine_id: integer(item.medicine_id, 'Medicine', 1),
      batch_number: text(item.batch_number, 'Batch number', 100, true),
      quantity: integer(item.quantity, 'Quantity', 1, 1000000),
      purchase_price: decimal(cents(price(item.purchase_price, 'Purchase price'))),
      selling_price: decimal(cents(price(item.selling_price, 'Selling price'))),
      expiry_date: date(item.expiry_date, 'Expiry date')
    };
    const key = `${parsed.medicine_id}:${parsed.batch_number.toLowerCase()}`;
    if (seen.has(key)) fail('Combine duplicate medicine/batch lines into one item.');
    seen.add(key);
    if (sellingPrices.has(parsed.medicine_id) && sellingPrices.get(parsed.medicine_id) !== parsed.selling_price) fail('Use the same selling price for all batches of a medicine in this purchase.');
    sellingPrices.set(parsed.medicine_id, parsed.selling_price);
    const subtotal = cents(parsed.purchase_price) * BigInt(parsed.quantity);
    total += subtotal;
    if (total > 99999999999999n) fail('Purchase total is too large.');
    return {
      ...parsed,
      subtotal: decimal(subtotal)
    };
  });
  // Monetary arithmetic stays in integer minor units; client totals are never trusted.
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(String(input.amount_paid))) fail('Amount paid must be non-negative with at most two decimal places.');
  const paid = cents(input.amount_paid);
  if (paid > total) fail('Amount paid cannot exceed the purchase total.');
  data.amount_paid = decimal(paid);
  data.total_amount = decimal(total);
  data.payment_status = paid === total ? 'PAID' : paid === 0n ? 'UNPAID' : 'PARTIAL';
  return data;
}
function filters(query, resource) {
  const data = {
    page: integer(query.page ?? 1, 'Page', 1, 1000000),
    limit: integer(query.limit ?? 10, 'Page size', 1, 100),
    search: text(query.search || '', 'Search', 150) || ''
  };
  if (resource === 'suppliers') {
    data.status = query.status || '';
    if (!['', 'ACTIVE', 'INACTIVE'].includes(data.status)) fail('Invalid supplier status.');
  } else {
    data.payment_status = query.payment_status || '';
    if (!['', 'PAID', 'PARTIAL', 'UNPAID'].includes(data.payment_status)) fail('Invalid payment status.');
    if (query.supplier_id) data.supplier_id = integer(query.supplier_id, 'Supplier', 1);
    if (query.from) data.from = date(query.from, 'Start date');
    if (query.to) data.to = date(query.to, 'End date');
    if (data.from && data.to && data.from > data.to) fail('Start date must be on or before end date.');
  }
  return data;
}
module.exports = {
  supplier,
  purchase,
  filters,
  object,
  today,
  cents,
  decimal
};
