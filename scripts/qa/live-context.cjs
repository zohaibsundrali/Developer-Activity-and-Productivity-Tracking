const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
require('@next/env').loadEnvConfig(process.cwd());
const env = Object.fromEntries(fs.readFileSync('.env.e2e','utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const options = {auth:{persistSession:false,autoRefreshToken:false}};
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const sessions = new Map();
async function session(role) {
 if(sessions.has(role)) return sessions.get(role);
 const key = role.toUpperCase(), email = env[`E2E_${key}_EMAIL`];
 assert.match(email || '', /^verisade-qa-.*@example\.com$/,'Only explicitly synthetic accounts are allowed');
 const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
 const {data,error}=await client.auth.signInWithPassword({email,password:env[`E2E_${key}_PASSWORD`]});
 assert.equal(error,null,`QA ${role} sign in`);
 const claims=data.user.app_metadata;
 const org=await svc.from('organizations').select('id,name').eq('id',claims.organization_id).single();
 assert.equal(org.error,null);assert.match(org.data.name,/^QA Test Org [AB]$/);
 const value={client,token:data.session.access_token,id:claims.app_user_id,type:claims.user_type,org:claims.organization_id,role:claims.role};sessions.set(role,value);return value;
}
async function api(role,method,path,body) {
 const s=await session(role);
 const r=await fetch((process.env.E2E_BASE_URL || env.E2E_BASE_URL)+path,{method,headers:{Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)}).catch(error=>{throw new Error(`${method} ${path}: ${error.message}`)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={error:text.slice(0,200)}}
 return {status:r.status,body:data};
}
async function row(table,id) { const r=await svc.from(table).select('*').eq('id',id).single();assert.equal(r.error,null);return r.data; }
module.exports={api,session,svc,env,row};
