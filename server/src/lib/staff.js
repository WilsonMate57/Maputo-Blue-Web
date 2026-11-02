// ─────────────────────────────────────────────────────────────────────────────
// staff.js — Team invitations, shared by the Team page and `npm run create-admin`.
// An invited account has no usable password until the e-mailed link is used.
// ─────────────────────────────────────────────────────────────────────────────
import { issueToken } from '../routes/auth.js';
import { enqueueMail } from './mailer.js';
import { sha256 } from './security.js';

export const ROLE_LABELS = { superadmin: 'Superadministrador', admin: 'Administrador', manager: 'Gestor' };
export const NO_PASSWORD = '!invited';
const INVITE_HOURS = 72;

export async function sendStaffInvite(c, cfg, u) {
  const t = await issueToken(c, u.id, 'reset_password', INVITE_HOURS);
  await enqueueMail(c, { key: `invite:${sha256(t)}`, to: u.email, template: 'staff_invite', locale: 'pt', data: {
    name: u.name, role_label: ROLE_LABELS[u.role], admin_url: `${cfg.publicBaseUrl}/admin/`,
    url: `${cfg.publicBaseUrl}/admin/?invite=${encodeURIComponent(t)}` } });
}
