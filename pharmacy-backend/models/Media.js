const pool = require('../config/db');
const {
  fail
} = require('../validators/catalog');
const pattern = /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
exports.idFromUrl = value => typeof value === 'string' ? value.match(pattern)?.[1] : null;
exports.find = async id => {
  const [[row]] = await pool.query('SELECT content,content_type,width,height FROM image_uploads WHERE id=?', [id]);
  return row;
};
exports.reference = async (connection, url, purpose) => {
  if (!url) return null;
  const id = exports.idFromUrl(url);
  if (!id) fail('Select an uploaded image.');
  const [[row]] = await connection.query('SELECT id FROM image_uploads WHERE id=? AND purpose=?', [id, purpose]);
  if (!row) fail('The selected image is unavailable or has the wrong purpose.');
  return id;
};
exports.save = async (data, user) => {
  const {
    permissionsFor
  } = require('../config/permissions');
  const permissions = permissionsFor(user.role);
  require('../validators/purchasing').object(data, ['purpose', 'image']);
  if (!['medicine', 'logo'].includes(data.purpose)) fail('Choose a valid image purpose.');
  if (!permissions.includes(data.purpose === 'logo' ? 'settings' : 'medicines:write')) fail('You cannot upload this image.', 403);
  if (typeof data.image !== 'string' || data.image.length > 2800000) fail('Image must be at most 2 MB.');
  const match = data.image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) fail('Select a JPEG, PNG or WebP image.');
  const source = Buffer.from(match[2], 'base64');
  if (!source.length || source.length > 2 * 1024 * 1024) fail('Image must be at most 2 MB.');
  let output, info;
  try {
    const sharp = require('sharp');
    const metadata = await sharp(source, {
      limitInputPixels: 20000000,
      failOn: 'error'
    }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) fail('Use a single-frame JPEG, PNG or WebP image.');
    ({
      data: output,
      info
    } = await sharp(source, {
      limitInputPixels: 20000000,
      failOn: 'error'
    }).rotate().resize(1200, 1200, {
      fit: 'inside',
      withoutEnlargement: true
    }).png().toBuffer({
      resolveWithObject: true
    }));
  } catch (error) {
    if (error.status) throw error;
    fail('This image could not be decoded. Choose a valid image up to 20 megapixels.');
  }
  const id = require('node:crypto').randomUUID();
  await pool.query('INSERT INTO image_uploads SET ?', [{
    id,
    purpose: data.purpose,
    content: output,
    content_type: 'image/png',
    width: info.width,
    height: info.height,
    created_by: user.id
  }]);
  return {
    url: '/api/media/' + id,
    width: info.width,
    height: info.height
  };
};
