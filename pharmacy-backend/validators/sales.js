const { object, cents, decimal, filters } = require('./purchasing');
const { integer, text, price, fail } = require('./catalog');
exports.body = input => {
  object(input, ['request_key', 'customer_id', 'prescription_id', 'customer_name', 'discount', 'amount_paid', 'payment_method', 'items']);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_key)) fail('A valid request key is required.');
  if (!['CASH', 'CARD', 'MOBILE_MONEY', 'OTHER'].includes(input.payment_method)) fail('Select a payment method.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail('Select between 1 and 100 medicines.');
  const seen = new Set();
  const items = input.items.map(item => {
    object(item, ['medicine_id', 'quantity', 'unit_price']);
    const medicine_id = integer(item.medicine_id, 'Medicine', 1);
    if (seen.has(medicine_id)) fail('Combine repeated medicines into one cart line.');
    seen.add(medicine_id);
    return { medicine_id, quantity: integer(item.quantity, 'Quantity', 1, 1000000), unit_price: decimal(cents(price(item.unit_price, 'Unit price'))) };
  }).sort((a, b) => a.medicine_id - b.medicine_id);
  return { ...(input.customer_id !== undefined && input.customer_id !== null && input.customer_id !== "" ? { customer_id: integer(input.customer_id,'Customer',1) } : {}), ...(input.prescription_id !== undefined && input.prescription_id !== null && input.prescription_id !== "" ? { prescription_id: integer(input.prescription_id,'Prescription',1) } : {}), request_key: input.request_key.toLowerCase(), customer_name: text(input.customer_name, 'Customer', 150),
    discount: decimal(cents(price(input.discount, 'Discount'))), amount_paid: decimal(cents(price(input.amount_paid, 'Amount paid'))),
    payment_method: input.payment_method, items };
};
exports.filters = query => filters(query, 'sales');
