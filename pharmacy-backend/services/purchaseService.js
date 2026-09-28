const crypto = require('node:crypto');
const Purchase = require('../models/Purchase');
const Supplier = require('../models/Supplier');
const transaction = require('../utilities/transaction');
const {
  fail
} = require('../validators/catalog');
const {
  today
} = require('../validators/purchasing');
async function find(id) {
  const row = await Purchase.find(id);
  if (!row) fail('Purchase not found.', 404);
  return row;
}
function replay(row, hash, userId) {
  if (row.request_hash !== hash || row.created_by !== userId) fail('This request key was already used for a different purchase. Start a new receipt.', 409);
  return row.id;
}
async function complete(data, userId) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const existing = await Purchase.byRequest(data.request_key);
  if (existing) return {
    data: await find(replay(existing, hash, userId)),
    replayed: true
  };
  let replayed = false;
  try {
    const id = await transaction(async connection => {
      // Supplier lock serializes receiving with supplier deactivation.
      const supplier = await Supplier.lock(connection, data.supplier_id);
      const previous = await Purchase.byRequest(data.request_key, connection);
      if (previous) {
        replayed = true;
        return replay(previous, hash, userId);
      }
      if (!supplier || supplier.status !== 'ACTIVE') fail('Select an active supplier.', 409);
      if (data.items.some(item => item.expiry_date < today())) fail('Expired batches cannot be received.');
      const medicines = new Map();
      // Always lock medicines in ascending order to prevent opposing receipt deadlocks.
      for (const medicineId of [...new Set(data.items.map(item => item.medicine_id))].sort((a, b) => a - b)) {
        const medicine = await Purchase.lockMedicine(connection, medicineId);
        if (!medicine || medicine.status !== 'ACTIVE') fail('A selected medicine is no longer active. Reload the receipt.', 409);
        medicines.set(medicineId, medicine);
      }
      const {
        items,
        ...header
      } = data;
      const purchaseNumber = `PUR-${today().replaceAll('-', '')}-${crypto.randomUUID().slice(0, 13).replace('-', '').toUpperCase()}`;
      const purchaseId = await Purchase.create(connection, {
        ...header,
        supplier_name: supplier.name,
        purchase_number: purchaseNumber,
        request_hash: hash,
        created_by: userId
      });
      for (const item of items) {
        const previousStock = await Purchase.stock(connection, item.medicine_id);
        const newStock = previousStock + item.quantity;
        if (newStock > 2147483647) fail('Receiving this quantity would exceed the stock limit.');
        let batch = await Purchase.batch(connection, item.medicine_id, item.batch_number);
        if (batch) {
          if (batch.expiry_date !== item.expiry_date || batch.purchase_price !== item.purchase_price) fail('An existing batch has a different expiry date or purchase price. Check the supplier batch details.', 409);
          await Purchase.increaseBatch(connection, batch.id, item.quantity);
        } else {
          batch = {
            id: await Purchase.createBatch(connection, {
              medicine_id: item.medicine_id,
              batch_number: item.batch_number,
              expiry_date: item.expiry_date,
              quantity: item.quantity,
              purchase_price: item.purchase_price
            })
          };
        }
        const itemId = await Purchase.createItem(connection, {
          ...item,
          medicine_name: medicines.get(item.medicine_id).name,
          purchase_id: purchaseId,
          batch_id: batch.id
        });
        await Purchase.movement(connection, {
          medicine_id: item.medicine_id,
          batch_id: batch.id,
          purchase_item_id: itemId,
          type: 'PURCHASE',
          quantity: item.quantity,
          previous_stock: previousStock,
          new_stock: newStock,
          reference: purchaseNumber,
          reason: 'Stock received from supplier',
          created_by: userId
        });
        await Purchase.updatePrices(connection, item.medicine_id, item.purchase_price, item.selling_price, userId);
      }
      await require('./operationsService').audit(connection,userId,'COMPLETED_PURCHASE','Purchase',purchaseId,purchaseNumber);
      return purchaseId;
    });
    return {
      data: await find(id),
      replayed
    };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const committed = await Purchase.byRequest(data.request_key);
      if (committed) return {
        data: await find(replay(committed, hash, userId)),
        replayed: true
      };
      fail('This supplier invoice has already been received, or the receipt repeats a batch. Check the existing purchases.', 409);
    }
    throw error;
  }
}
module.exports = {
  find,
  complete
};
