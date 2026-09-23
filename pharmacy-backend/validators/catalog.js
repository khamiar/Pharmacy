const types = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Other'];
function fail(message, status = 400) {
  throw Object.assign(new Error(message), {
    status
  });
}
function integer(value, name, min = 0, max = 2147483647) {
  if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) fail(`${name} must be a whole number between ${min} and ${max}.`);
  return Number(value);
}
function text(value, name, max, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') fail(`${name} must be text.`);
  const result = value.trim();
  if (required && !result || result.length > max) fail(`${name} is required and must be at most ${max} characters.`);
  return result || null;
}
function price(value, name) {
  if (!/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(String(value))) fail(`${name} must be a non-negative price with at most two decimal places.`);
  return String(value);
}
function body(input, resource, editing = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A JSON object is required.');
  const common = ['name', 'description', ...(editing ? ['version'] : [])];
  const allowed = resource === 'categories' ? common : [...common, 'generic_name', 'brand_name', 'category_id', 'medicine_type', 'manufacturer', 'barcode', 'purchase_price', 'selling_price', 'minimum_stock', 'storage_location'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(`${key} cannot be changed here. Stock and batches require stock transactions.`);
  const data = {
    name: text(input.name, 'Name', 150, true),
    description: text(input.description, 'Description', 5000)
  };
  if (editing) data.version = integer(input.version, 'Version', 1);
  if (resource === 'medicines') {
    for (const key of ['generic_name', 'brand_name', 'manufacturer', 'storage_location']) data[key] = text(input[key], key.replaceAll('_', ' '), 150);
    data.barcode = text(input.barcode, 'Barcode', 100);
    data.category_id = input.category_id == null || input.category_id === '' ? null : integer(input.category_id, 'Category', 1);
    data.medicine_type = input.medicine_type;
    if (!types.includes(data.medicine_type)) fail('Select a valid medicine type.');
    data.purchase_price = price(input.purchase_price, 'Purchase price');
    data.selling_price = price(input.selling_price, 'Selling price');
    data.minimum_stock = integer(input.minimum_stock, 'Minimum stock');
  }
  return data;
}
function filters(query, resource) {
  const statuses = resource === 'medicines' ? ['ACTIVE', 'ARCHIVED'] : ['ACTIVE', 'INACTIVE'];
  const sortKeys = resource === 'medicines' ? ['name', 'selling_price', 'quantity', 'created_at'] : ['name', 'created_at'];
  const status = query.status || '';
  if (status && !statuses.includes(status)) fail('Invalid status filter.');
  const sort = query.sort || 'name';
  if (!sortKeys.includes(sort)) fail('Invalid sort field.');
  const direction = query.direction || 'asc';
  if (!['asc', 'desc'].includes(direction)) fail('Invalid sort direction.');
  const stock = query.stock || '';
  if (!['', 'low', 'out', 'in'].includes(stock)) fail('Invalid stock filter.');
  const expiry = query.expiry || '';
  if (!['', 'expired', '30', '60', '90'].includes(expiry)) fail('Invalid expiry filter.');
  return {
    page: integer(query.page ?? 1, 'Page', 1, 1000000),
    limit: integer(query.limit ?? 10, 'Page size', 1, 100),
    search: text(query.search ?? '', 'Search', 150) || '',
    status,
    sort,
    direction,
    stock,
    expiry,
    category: query.category ? integer(query.category, 'Category', 1) : null
  };
}
module.exports = {
  body,
  filters,
  integer,
  fail,
  types, text, price
};
