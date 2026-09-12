import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const sql = readFileSync(new URL('../scripts/sql/missing-profile-recovery-evidence.sql', import.meta.url), 'utf8');
it('keeps the operator diagnostic SELECT-only with no recovery function invocation', () => {
 const executable = sql.replace(/--[^\n]*/g, '');
 expect(executable.trimStart()).toMatch(/^with profiles as/);
 expect(executable).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|perform|call)\b/i);
 expect(executable).not.toMatch(/operator_repair|finish_signup|finish_profile|finish_invitation|set_config/);
 expect(executable).toContain('false automatic_reconstruction_allowed');
});
it('projects only selected evidence rather than whole sensitive source records', () => {
 expect(sql).not.toMatch(/to_jsonb\((?:u|s|r|a|i)\)/);
 expect(sql).not.toMatch(/(?:u|s|r|a|i)\.\*/);
 expect(sql).not.toContain('signup_grant_hash');
 expect(sql).not.toContain('claim_id');
 expect(sql).not.toContain('code_hash');
});
