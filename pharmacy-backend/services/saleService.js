const crypto = require('node:crypto');
const Sale = require('../models/Sale');
const Purchase = require('../models/Purchase');
const transaction = require('../utilities/transaction');
const { cents, decimal, today } = require('../validators/purchasing');
const { fail } = require('../validators/catalog');
exports.complete = async (data, userId, role) => {
  if (data.prescription_id && !require('../config/permissions').permissionsFor(role).includes('prescriptions:write')) fail('Only a pharmacist or administrator can dispense prescriptions.',403);
  const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const replay = async () => {
    const row = await Sale.byRequest(data.request_key);
    if (!row) return null;
    if (row.created_by !== userId || row.request_hash !== hash) fail('This checkout was already submitted with different details. Review sales history.', 409);
    return Sale.find(row.id);
  };
  const previous = await replay();
  if (previous) return previous;
  try {
    const id = await transaction(async connection => {
      let customerId=data.customer_id || null, customerName=data.customer_name;
      if(data.prescription_id){
        const [[rx]]=await connection.query('SELECT * FROM prescriptions WHERE id=? FOR UPDATE',[data.prescription_id]);
        if(!rx || !['PENDING','PARTIALLY_DISPENSED'].includes(rx.status)) fail('Prescription is not available for dispensing.',409);
        if(customerId && customerId!==rx.customer_id) fail('Customer does not match the prescription.');
        customerId=rx.customer_id;
        const [rxItems]=await connection.query('SELECT * FROM prescription_items WHERE prescription_id=? FOR UPDATE',[rx.id]);
        for(const item of data.items){
          const prescribed=rxItems.find(row=>row.medicine_id===item.medicine_id);
          if(!prescribed || item.quantity>prescribed.quantity-prescribed.dispensed_quantity) fail('Sale exceeds the remaining prescribed quantity.',409);
        }
      }
      if(customerId){
        const [[customer]]=await connection.query('SELECT full_name FROM customers WHERE id=? FOR UPDATE',[customerId]);
        if(!customer) fail('Customer not found.',404);
        customerName=customer.full_name;
      }
      const settings=await require('../models/Settings').get(connection);
      const lines = [];
      let subtotal = 0n;
      // Same lock ordering as purchases; current reads protect against concurrent receipts/sales.
      for (const item of data.items) {
        const medicine = await Purchase.lockMedicine(connection, item.medicine_id);
        if (!medicine || medicine.status !== 'ACTIVE') fail('A medicine is no longer available.', 409);
        if (cents(medicine.selling_price) !== cents(item.unit_price)) fail('A selling price changed. Refresh the cart before checkout.', 409);
        const [batches] = await connection.query("SELECT id,batch_number,quantity,purchase_price,DATE_FORMAT(expiry_date,'%Y-%m-%d') expiry_date FROM medicine_batches WHERE medicine_id=? ORDER BY expiry_date,id FOR UPDATE", [item.medicine_id]);
        let remaining = item.quantity;
        let stock = batches.reduce((sum, batch) => sum + batch.quantity, 0);
        for (const batch of batches) {
          if (!remaining) break;
          if (!batch.quantity || batch.expiry_date < today()) continue;
          const quantity = Math.min(remaining, batch.quantity);
          const amount = cents(medicine.selling_price) * BigInt(quantity);
          lines.push({ medicine_id: medicine.id, medicine_name: medicine.name, batch_id: batch.id, batch_number: batch.batch_number, quantity, unit_price: medicine.selling_price, unit_cost: batch.purchase_price, subtotal: decimal(amount), previous_stock: stock, new_stock: stock - quantity });
          subtotal += amount; stock -= quantity; remaining -= quantity;
        }
        if (remaining) fail(`Insufficient non-expired stock for ${medicine.name}.`, 409);
      }
      const discount = cents(data.discount), paid = cents(data.amount_paid);
      if (subtotal > 99999999999999n || discount > subtotal) fail('Invalid sale total or discount.');
      const total = subtotal - discount;
      if (paid < total) fail('Amount paid must cover the total.');
      const invoice = `${settings.invoice_prefix}-${today().replaceAll('-', '')}-${crypto.randomUUID().slice(0, 13).replace('-', '').toUpperCase()}`;
      const [result] = await connection.query('INSERT INTO sales SET ?', [{ invoice_number: invoice, sale_date: today(), customer_name: customerName, subtotal: decimal(subtotal), discount: data.discount, total_amount: decimal(total), amount_paid: data.amount_paid, change_amount: decimal(paid-total), payment_method: data.payment_method, request_key: data.request_key, request_hash: hash, created_by: userId }]);
      const {pharmacy_name,address,phone,email,registration_number,currency,invoice_footer,logo_url,invoice_title,invoice_terms,invoice_show_logo,website,business_hours}=settings;
      await connection.query('INSERT INTO sale_details SET ?',[{sale_id:result.insertId,customer_id:customerId,prescription_id:data.prescription_id||null,pharmacy_profile:JSON.stringify({pharmacy_name,address,phone,email,registration_number,currency,invoice_footer,logo_url,invoice_title,invoice_terms,invoice_show_logo,website,business_hours})}]);
      if(data.prescription_id){
        for(const item of data.items) await connection.query('UPDATE prescription_items SET dispensed_quantity=dispensed_quantity+? WHERE prescription_id=? AND medicine_id=?',[item.quantity,data.prescription_id,item.medicine_id]);
        const [[remaining]]=await connection.query('SELECT SUM(quantity-dispensed_quantity) quantity FROM prescription_items WHERE prescription_id=?',[data.prescription_id]);
        const status=Number(remaining.quantity)===0?'DISPENSED':'PARTIALLY_DISPENSED';
        await connection.query('UPDATE prescriptions SET status=?,version=version+1,updated_by=? WHERE id=?',[status,userId,data.prescription_id]);
        await require('./operationsService').audit(connection,userId,'DISPENSED_PRESCRIPTION','Prescription',data.prescription_id,invoice);
      }
      for (const { previous_stock, new_stock, ...line } of lines) {
        await connection.query('INSERT INTO sale_items SET ?', [{ ...line, sale_id: result.insertId }]);
        const [updated] = await connection.query('UPDATE medicine_batches SET quantity=quantity-? WHERE id=? AND quantity>=?', [line.quantity, line.batch_id, line.quantity]);
        if (updated.affectedRows !== 1) fail('Stock changed. Reload the cart.', 409);
        await Purchase.movement(connection, { medicine_id: line.medicine_id, batch_id: line.batch_id, type: 'SALE', quantity: -line.quantity, previous_stock, new_stock, reference: invoice, reason: 'Sale completed', created_by: userId });
      }
      await connection.query("INSERT INTO audit_logs (user_id,action,entity,entity_id,description) VALUES (?,'COMPLETED_SALE','Sale',?,?)", [userId, result.insertId, invoice]);
      return result.insertId;
    });
    return Sale.find(id);
  } catch (error) {
    const existing = await replay();
    if (existing) return existing;
    throw error;
  }
};
