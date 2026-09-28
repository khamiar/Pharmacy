const {
  object,
  today
} = require('./purchasing');
const {
  integer,
  text,
  fail
} = require('./catalog');
const date = (value, label) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') fail(`${label} must be a valid date.`);
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > today()) fail(`${label} must be a valid date, not in the future.`);
  return value;
};
exports.customer = (input, editing) => {
  object(input, ['full_name', 'phone', 'email', 'address', 'date_of_birth', 'notes', ...(editing ? ['version'] : [])]);
  const data = {
    full_name: text(input.full_name, 'Full name', 150, true),
    phone: text(input.phone, 'Phone', 30),
    email: text(input.email, 'Email', 150),
    address: text(input.address, 'Address', 1000),
    notes: text(input.notes, 'Notes', 3000),
    date_of_birth: input.date_of_birth ? date(input.date_of_birth, 'Date of birth') : null
  };
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('Enter a valid email.');
  if (editing) data.version = integer(input.version, 'Version', 1);
  return data;
};
exports.prescription = (input, editing) => {
  object(input, ['customer_id', 'doctor', 'prescription_date', 'notes', 'items', editing ? 'version' : 'request_key']);
  const data = {
    customer_id: integer(input.customer_id, 'Customer', 1),
    doctor: text(input.doctor, 'Doctor', 150, true),
    prescription_date: date(input.prescription_date, 'Prescription date'),
    notes: text(input.notes, 'Notes', 3000)
  };
  if (editing) data.version = integer(input.version, 'Version', 1);else {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_key)) fail('A valid request key is required.');
    data.request_key = input.request_key.toLowerCase();
  }
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail('Add between 1 and 100 prescription items.');
  const seen = new Set();
  data.items = input.items.map(item => {
    object(item, ['medicine_id', 'dosage', 'frequency', 'duration', 'quantity', 'instructions']);
    const medicine_id = integer(item.medicine_id, 'Medicine', 1);
    if (seen.has(medicine_id)) fail('Combine duplicate medicine lines.');
    seen.add(medicine_id);
    return {
      medicine_id,
      dosage: text(item.dosage, 'Dosage', 150, true),
      frequency: text(item.frequency, 'Frequency', 150, true),
      duration: text(item.duration, 'Duration', 150, true),
      quantity: integer(item.quantity, 'Quantity', 1, 1000000),
      instructions: text(item.instructions, 'Instructions', 1000)
    };
  });
  return data;
};
exports.settings = input => {
  const fields = ['pharmacy_name', 'address', 'phone', 'email', 'logo_url', 'registration_number', 'currency', 'low_stock_threshold', 'expiry_warning_days', 'invoice_prefix', 'invoice_footer', 'version', 'alerts_enabled','alert_expiry_days','alert_stock_quantity','alert_interval_minutes','invoice_title','invoice_terms','invoice_show_logo','website','business_hours'];
  object(input, fields);
  const data = {};
  for (const [key, max] of Object.entries({
    pharmacy_name: 150,
    address: 1000,
    phone: 30,
    email: 150,
    logo_url: 1000,
    registration_number: 150,
    invoice_prefix: 12,
    invoice_footer: 500
  })) data[key] = text(input[key], key.replaceAll('_', ' '), max, ['pharmacy_name', 'invoice_prefix'].includes(key));
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('Enter a valid email.');
  if (data.logo_url && !require("../models/Media").idFromUrl(data.logo_url)) {
    let url;
    try {
      url = new URL(data.logo_url);
    } catch {
      fail('Enter a valid logo URL.');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('Logo URL must use HTTP or HTTPS without credentials.');
  }
  if (!/^[A-Z0-9-]{1,12}$/.test(data.invoice_prefix)) fail('Invoice prefix must use uppercase letters, numbers or hyphens.');
  if (input.currency !== 'TZS') fail('The accounting currency is TZS. Existing amounts cannot be relabelled.');
  data.currency = 'TZS';
  data.low_stock_threshold = integer(input.low_stock_threshold, 'Default low-stock threshold', 0, 1000000);
  data.expiry_warning_days = integer(input.expiry_warning_days, 'Expiry warning period', 1, 365);
  for(const [key,min,max] of [['alerts_enabled',0,1],['alert_expiry_days',1,365],['alert_stock_quantity',0,1000000],['alert_interval_minutes',1,1440],['invoice_show_logo',0,1]]) {
    if(input[key]!==undefined)data[key]=integer(input[key],key.replaceAll('_',' '),min,max);
  }
  for(const [key,max] of [['invoice_title',60],['invoice_terms',1000],['website',250],['business_hours',250]]) {
    if(input[key]!==undefined)data[key]=text(input[key],key.replaceAll('_',' '),max,key==='invoice_title');
  }
  if(data.website){let url;try{url=new URL(data.website);}catch{fail('Website must be an HTTP or HTTPS URL.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('Website must be an HTTP or HTTPS URL without credentials.');}
  data.version = integer(input.version, 'Version', 1);
  return data;
};
exports.page = query => ({
  page: integer(query.page || 1, 'Page', 1, 1000000),
  limit: integer(query.limit || 10, 'Page size', 1, 100),
  search: text(query.search || '', 'Search', 150) || ''
});
