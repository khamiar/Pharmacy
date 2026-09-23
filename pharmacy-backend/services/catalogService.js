const Catalog = require('../models/Catalog');
const {
  fail
} = require('../validators/catalog');
const transaction = require('../utilities/transaction');
async function activeCategory(connection, id) {
  if (!id) return;
  const category = await Catalog.lock(connection, 'categories', id);
  if (!category || category.status !== 'ACTIVE') fail('Select an active category.', 409);
}
async function find(resource, id) {
  const row = await Catalog.find(resource, id);
  if (!row) fail('Record not found.', 404);
  return row;
}
async function save(resource, data, userId, id) {
  const savedId = await transaction(async connection => {
    let current;
    if (id) {
      current = await Catalog.lock(connection, resource, id);
      if (!current) fail('Record not found.', 404);
      if (current.version !== data.version) fail('This record was changed by another user. Close the form and reload before editing.', 409);
      if (current.status !== 'ACTIVE') fail('Restore or activate this record before editing.', 409);
    }
    const {
      version,
      ...values
    } = data;
    if (resource === 'medicines') {
      await activeCategory(connection, values.category_id);
      values.updated_by = userId;
      if (!id) values.created_by = userId;
    }
    if (id) {
      await Catalog.update(connection, resource, id, values);
      return id;
    }
    return Catalog.create(connection, resource, values);
  });
  return find(resource, savedId);
}
async function changeStatus(resource, id, version, active, userId) {
  await transaction(async connection => {
    const row = await Catalog.lock(connection, resource, id);
    if (!row) fail('Record not found.', 404);
    if (row.version !== version) fail('This record changed. Reload before trying again.', 409);
    if (resource === 'medicines') {
      if (!active && (await Catalog.hasStock(connection, id))) fail('A medicine with stock cannot be archived. Use stock transactions first.', 409);
      if (active) await activeCategory(connection, row.category_id);
    } else if (!active && (await Catalog.hasActiveMedicines(connection, id))) {
      fail('Move or archive the active medicines in this category before deactivating it.', 409);
    }
    await Catalog.update(connection, resource, id, {
      status: active ? 'ACTIVE' : resource === 'medicines' ? 'ARCHIVED' : 'INACTIVE',
      ...(resource === 'medicines' ? {
        updated_by: userId
      } : {})
    });
  });
  return find(resource, id);
}
module.exports = {
  find,
  save,
  changeStatus
};
