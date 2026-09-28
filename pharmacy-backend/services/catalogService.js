const Catalog = require('../models/Catalog');
const crypto = require('node:crypto');
const { permissionsFor } = require('../config/permissions');
const {
  fail
} = require('../validators/catalog');
const transaction = require('../utilities/transaction');
const {audit}=require('./operationsService');
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
async function save(resource, data, userId, id, role) {
  const { opening_stock: opening, request_key: key, ...catalogData } = data;
  if (opening && (resource !== 'medicines' || id)) fail('Opening stock is only allowed when creating a medicine.');
  if (opening && !permissionsFor(role).includes('medicines:opening-stock')) fail('Only an administrator can record opening stock.', 403);
  const hash = opening ? crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex') : null;
  const replay = async () => {
    if (!opening) return null;
    const previous = await Catalog.creationRequest(key);
    if (!previous) return null;
    if (previous.user_id !== userId || previous.request_hash !== hash) fail('This form was already submitted with different details. Check the medicine list before starting again.', 409);
    return find(resource, previous.medicine_id);
  };
  const previous = await replay();
  if (previous) return previous;
  try {
    const savedId = await transaction(async connection => {
      if (id) {
        const current = await Catalog.lock(connection, resource, id);
        if (!current) fail('Record not found.', 404);
        if (current.version !== data.version) fail('This record was changed by another user. Close the form and reload before editing.', 409);
        if (current.status !== 'ACTIVE') fail('Restore or activate this record before editing.', 409);
      }
      const { version, image_url, ...values } = catalogData;
      const saveImage=async medicineId=>{
        if(image_url===undefined)return;
        const imageId=await require('../models/Media').reference(connection,image_url,'medicine');
        if(imageId)await connection.query('INSERT INTO medicine_images(medicine_id,image_id) VALUES(?,?) ON DUPLICATE KEY UPDATE image_id=VALUES(image_id)',[medicineId,imageId]);
        else await connection.query('DELETE FROM medicine_images WHERE medicine_id=?',[medicineId]);
      };
      if (resource === 'medicines') {
        await activeCategory(connection, values.category_id);
        values.updated_by = userId;
        if (!id) values.created_by = userId;
      }
      if (id) { await Catalog.update(connection, resource, id, values); if(resource==='medicines') await saveImage(id); await audit(connection,userId,'UPDATED_'+resource.toUpperCase(),resource,id,'Catalog record updated.'); return id; }
      // The newly inserted medicine row is exclusively held until commit.
      if (opening && opening.expiry_date < new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)) fail('Opening stock cannot include an expired batch.');
      const medicineId = await Catalog.create(connection, resource, values);
      if(resource==='medicines')await saveImage(medicineId);
      if (opening) await Catalog.saveOpeningStock(connection, medicineId, opening, values.purchase_price, userId, key, hash);
      await audit(connection,userId,'CREATED_'+resource.toUpperCase(),resource,medicineId,'Catalog record created.');
      return medicineId;
    });
    return find(resource, savedId);
  } catch (error) {
    if (opening && error.code === 'ER_DUP_ENTRY') {
      const committed = await replay();
      if (committed) return committed;
    }
    throw error;
  }
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
    await audit(connection,userId,'CHANGED_CATALOG_STATUS',resource,id,active?'Activated':'Archived or deactivated');
  });
  return find(resource, id);
}
module.exports = {
  find,
  save,
  changeStatus
};
