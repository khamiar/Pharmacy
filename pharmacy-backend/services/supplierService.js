const Supplier = require('../models/Supplier');
const transaction = require('../utilities/transaction');
const {
  fail
} = require('../validators/catalog');
async function find(id) {
  const row = await Supplier.find(id);
  if (!row) fail('Supplier not found.', 404);
  return row;
}
async function save(data, userId, id) {
  try {
    const savedId = await transaction(async connection => {
      if (id) {
        const row = await Supplier.lock(connection, id);
        if (!row) fail('Supplier not found.', 404);
        if (row.version !== data.version) fail('This supplier changed. Close the form and reload before editing.', 409);
      }
      const {
        version,
        ...values
      } = data;
      values.updated_by = userId;
      if (id) {
        await Supplier.update(connection, id, values);
        await require('./operationsService').audit(connection,userId,'UPDATED_SUPPLIER','Supplier',id,'Supplier updated.');
        return id;
      }
      const supplierId=await Supplier.create(connection, {
        ...values,
        created_by: userId
      });
      await require("./operationsService").audit(connection,userId,"CREATED_SUPPLIER","Supplier",supplierId,"Supplier created.");
      return supplierId;
    });
    return find(savedId);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') fail('A supplier with this registration number already exists.', 409);
    throw error;
  }
}
async function status(id, version, active, userId) {
  await transaction(async connection => {
    const row = await Supplier.lock(connection, id);
    if (!row) fail('Supplier not found.', 404);
    if (row.version !== version) fail('This supplier changed. Reload before trying again.', 409);
    await Supplier.update(connection, id, {
      status: active ? 'ACTIVE' : 'INACTIVE',
      updated_by: userId
    });
    await require('./operationsService').audit(connection,userId,'CHANGED_SUPPLIER_STATUS','Supplier',id,active?'Activated':'Deactivated');
  });
  return find(id);
}
module.exports = {
  find,
  save,
  status
};
