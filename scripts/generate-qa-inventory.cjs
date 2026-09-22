/** Source inventory, not a claim of runtime coverage. Re-run after adding routes/UI. */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.resolve(__dirname, '..');
function files(dir) { return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }
const result = { note: 'Static source discovery. Dynamic controls, resolved permissions and runtime outcomes require separate verification.', pages: [], routes: [], controls: [], forms: [], databaseCalls: [], apiCalls: [], permissionChecks: [], tests: [], parseErrors: [] };
for (const file of [...files('src'), ...files('e2e'), ...files('tests')].filter(f => /\.[cm]?[jt]sx?$/.test(f))) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  let ast; try { ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] }); }
  catch (e) { result.parseErrors.push({ file, error: e.message }); continue; }
  const loc = n => ({ file, line: n.loc.start.line });
  const snippet = n => n ? source.slice(n.start, n.end).replace(/\s+/g, ' ').slice(0, 350) : null;
  const str = n => n?.type === 'StringLiteral' ? n.value : snippet(n);
  if (/\/page\.[jt]sx?$/.test(file)) result.pages.push({ file, route: file.replace(/^src\/app/, '').replace(/\/page\.[jt]sx?$/, '') || '/' });
  const route = /\/route\.[jt]s$/.test(file) ? { file, route: file.replace(/^src\/app/, '').replace(/\/route\.[jt]s$/, ''), methods: [] } : null;
  if (route) result.routes.push(route);
  traverse(ast, {
    ExportNamedDeclaration(p) { const n = p.node.declaration; if(route && n?.type === 'VariableDeclaration') for(const d of n.declarations) if(/^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/.test(d.id?.name)) route.methods.push({method:d.id.name,line:d.loc.start.line}); if (route && n?.type === 'FunctionDeclaration' && /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/.test(n.id?.name)) route.methods.push({ method: n.id.name, line: n.loc.start.line }); },
    JSXElement(p) {
      const n = p.node, opening = n.openingElement, name = snippet(opening.name);
      const attributes = Object.fromEntries(opening.attributes.filter(a => a.type === 'JSXAttribute').map(a => [a.name.name, a.value?.type === 'StringLiteral' ? a.value.value : snippet(a.value)]));
      const label = n.children.filter(c => c.type === 'JSXText').map(c => c.value.trim()).filter(Boolean).join(' ');
      if (/^(button|Button|a|Link|input|Input|select|Select|textarea|Textarea|Checkbox|Switch|TabsTrigger|DropdownMenuItem|MenuItem)$/.test(name) || attributes.onClick || attributes.onChange) result.controls.push({ ...loc(n), element: name, label, attributes });
      if (name === 'form' || attributes.onSubmit) result.forms.push({ ...loc(n), element: name, attributes });
    },
    CallExpression(p) {
      const n = p.node, callee = n.callee, name = callee.type === 'MemberExpression' ? callee.property.name : callee.name;
      if (['from','rpc'].includes(name)) result.databaseCalls.push({ ...loc(n), method: name, target: str(n.arguments[0]) });
      if (['authFetch','fetch'].includes(name)) result.apiCalls.push({ ...loc(n), target: str(n.arguments[0]) });
      if (['authCan','can','allowed','requirePermission','roleCan'].includes(name)) result.permissionChecks.push({ ...loc(n), function: name, arguments: n.arguments.map(str) });
      if ((file.startsWith('e2e/') || file.startsWith('tests/')) && ['test','it'].includes(name) && n.arguments[0]?.type === 'StringLiteral') result.tests.push({ ...loc(n), title: n.arguments[0].value, layer: file.startsWith('e2e/') ? 'browser' : 'unit' });
    }
  });
}
const rolesSource = fs.readFileSync(path.join(root, 'src/utils/roles.js'), 'utf8');
result.roles = [...rolesSource.match(/export const ROLES = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
result.platformAccess = 'Separate platform-owner grant; not an organization role. See src/utils/platformOwner.js.';
result.permissions = [...fs.readFileSync(path.join(root, 'src/utils/permissionCatalogue.js'), 'utf8').matchAll(/\{ key: "([^"]+)", roles: (.+?), module: "([^"]+)", label: "([^"]+)"/g)].map(m => ({ key: m[1], roleExpression: m[2], module: m[3], label: m[4] }));
result.sqlFixtures = files('database/tests').filter(f => f.endsWith('.sql'));
result.migrations = files('supabase/migrations').filter(f => f.endsWith('.sql'));
const out = path.join(root, 'docs/qa-feature-inventory.json');
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).filter(([,v]) => Array.isArray(v)).map(([k,v]) => [k,v.length])), null, 2));
if (result.parseErrors.length) process.exitCode = 1;
