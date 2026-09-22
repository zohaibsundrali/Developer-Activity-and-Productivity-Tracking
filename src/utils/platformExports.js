export const PLATFORM_EXPORTS = Object.freeze({
  organizations: { table:'organizations', columns:'id,name,status,industry,country,timezone,created_at', permission:'organizations.read', searchColumn:'name', organizationColumn:'id' },
  projects: { table:'projects', columns:'id,organization_id,name,status,archived,deadline,created_at', permission:'projects.read', searchColumn:'name', project:true },
  members: { table:'memberships', columns:'id,organization_id,email,user_type,role,status,created_at', permission:'members.manage', searchColumn:'email' },
  invoices: { table:'billing_invoices', columns:'id,organization_id,status,currency,amount_paid_cents,amount_due_cents,created_at', permission:'billing.read' },
  subscriptions: { table:'organization_subscriptions', columns:'id,organization_id,plan_code,status,current_period_end,trial_end,cancel_at_period_end,created_at', permission:'billing.read' },
});
export function csvCell(value) {
  let cell = value == null ? '' : String(value);
  // Quoting alone does not stop spreadsheet formula execution.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g,'""')}"`;
}
export function platformCsv(columns, rows) {
  return '\ufeff'+[columns.map(csvCell).join(','),...rows.map(row=>columns.map(column=>csvCell(row[column])).join(','))].join('\r\n');
}
