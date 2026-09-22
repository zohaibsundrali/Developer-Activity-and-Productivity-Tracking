import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadE2EEnvFile } from '../e2e/fixtures/env';
const dirs = [];
function fixture() { const root=mkdtempSync(path.join(tmpdir(),'qa-env-test-'));dirs.push(root);writeFileSync(path.join(root,'.env.e2e'),'QA_ENV_TEST_A=old\nQA_ENV_TEST_B=default-only\n');return root; }
afterEach(()=>{vi.unstubAllEnvs();delete process.env.QA_ENV_TEST_A;delete process.env.QA_ENV_TEST_B;for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
it('loads the default file when no override is set',()=>{vi.stubEnv('E2E_ENV_FILE','');const root=fixture();expect(loadE2EEnvFile(root).loaded).toBe(true);expect(process.env.QA_ENV_TEST_A).toBe('old');});
it.each([true,false])('loads an explicit file exclusively (absolute=%s)',absolute=>{const root=fixture();writeFileSync(path.join(root,'run.env'),'QA_ENV_TEST_A=new\n');vi.stubEnv('E2E_ENV_FILE',absolute?path.join(root,'run.env'):'run.env');loadE2EEnvFile(root);expect(process.env.QA_ENV_TEST_A).toBe('new');expect(process.env.QA_ENV_TEST_B).toBeUndefined();});
it('preserves explicit process environment precedence',()=>{const root=fixture();vi.stubEnv('E2E_ENV_FILE',path.join(root,'.env.e2e'));vi.stubEnv('QA_ENV_TEST_A','process');loadE2EEnvFile(root);expect(process.env.QA_ENV_TEST_A).toBe('process');});
it('refuses missing explicit file instead of falling back',()=>{const root=fixture();vi.stubEnv('E2E_ENV_FILE','missing.env');expect(()=>loadE2EEnvFile(root)).toThrow('E2E_ENV_FILE');expect(process.env.QA_ENV_TEST_A).toBeUndefined();});
it('allows absent default file for credential-free test listing',()=>{vi.stubEnv('E2E_ENV_FILE','');const root=mkdtempSync(path.join(tmpdir(),'qa-empty-env-'));dirs.push(root);expect(loadE2EEnvFile(root).loaded).toBe(false);});
