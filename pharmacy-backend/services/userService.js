const User = require('../models/User');
const transaction = require('../utilities/transaction');
const { fail } = require('../validators/catalog');
async function changeAccess(actorId, targetId, version, action, role) {
  await transaction(async connection => {
    await User.administrationLock(connection);
    // Recheck after locking: another admin may have changed this actor's access.
    const actor = await User.lock(connection, actorId);
    if (!actor || actor.role !== 'admin' || actor.status !== 'ACTIVE') fail('Only an active administrator can manage staff.', 403);
    const target = await User.lock(connection, targetId);
    if (!target) fail('Staff account not found.', 404);
    if (actorId === targetId) fail('You cannot change your own role or approval status. Ask another administrator.', 409);
    if (target.version !== version) fail('This account changed. Reload the staff list before trying again.', 409);
    const updated = { role: target.role, status: target.status, actorId };
    if (action === 'approve') {
      if (!['PENDING', 'REJECTED'].includes(target.status)) fail('Only pending or rejected staff can be approved.', 409);
      updated.status = 'ACTIVE'; updated.role = 'staff';
    } else if (action === 'reject') {
      if (target.status !== 'PENDING') fail('Only pending registrations can be rejected.', 409);
      updated.status = 'REJECTED';
    } else if (action === 'suspend') {
      if (target.status !== 'ACTIVE') fail('Only active accounts can be suspended.', 409);
      updated.status = 'SUSPENDED';
    } else if (action === 'activate') {
      if (target.status !== 'SUSPENDED') fail('Only suspended accounts can be reactivated.', 409);
      updated.status = 'ACTIVE';
    } else if (action === 'role') {
      if (target.status !== 'ACTIVE') fail('Approve the staff account before assigning a role.', 409);
      updated.role = role;
      if (updated.role === target.role) fail('This account already has that role.', 409);
    } else fail('Unknown staff action.');
    if (target.role === 'admin' && target.status === 'ACTIVE' && (updated.role !== 'admin' || updated.status !== 'ACTIVE') && await User.activeAdmins(connection) <= 1) fail('The last active administrator must be retained.', 409);
    await User.updateAccess(connection, targetId, updated);
    await User.audit(connection, actorId, targetId, `USER_${action.toUpperCase()}`, target, updated);
  });
  return User.findById(targetId);
}
async function bootstrapAdmin(targetId) {
  await transaction(async connection => {
    await User.administrationLock(connection);
    if (await User.activeAdmins(connection) > 0) fail('An active administrator already exists. Additional admins must be selected through Users / Staff.', 409);
    const target = await User.lock(connection, targetId);
    if (!target) fail('The selected account does not exist.', 404);
    const updated = { role: 'admin', status: 'ACTIVE', actorId: null };
    await User.updateAccess(connection, targetId, updated);
    await User.audit(connection, null, targetId, 'INITIAL_ADMIN_SETUP', target, updated);
  });
  return User.findById(targetId);
}
module.exports = { changeAccess, bootstrapAdmin };
