import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({values:[],refs:[],effects:[],cursor:0,refCursor:0,identity:'first',denied:[],fetch:vi.fn(),authChanged:null}));
vi.mock('react',async()=>({...await vi.importActual('react'),useState:initial=>{const i=h.cursor++;if(!(i in h.values))h.values[i]=typeof initial==='function'?initial():initial;return[h.values[i],value=>{h.values[i]=typeof value==='function'?value(h.values[i]):value;}];},useRef:initial=>{const i=h.refCursor++;return h.refs[i]||={current:initial};},useEffect:callback=>{h.effects.push(callback);}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({authStatus:'authenticated'})}));
vi.mock('@/utils/orgContext',()=>({getOrgContext:()=>({identity:h.identity})}));
vi.mock('@/utils/reportViewState',()=>({reportIdentity:value=>value.identity}));
vi.mock('@/utils/permissions',()=>({allowed:key=>!h.denied.includes(key)}));
vi.mock('@/utils/supabaseClient',()=>({supabase:{auth:{onAuthStateChange:callback=>{h.authChanged=callback;return{data:{subscription:{unsubscribe(){}}}};}}}}));
vi.mock('@/utils/authFetch',()=>({authFetch:h.fetch}));
vi.mock('@/components/ui',()=>({Button:'button',PageHeader:'header'}));
globalThis.React=await vi.importActual('react');
const {default:View}=await import('@/components/shared/MobileFieldHistory');
function nodes(node,predicate){if(!node||typeof node!=='object')return[];return[...(predicate(node)?[node]:[]),...[].concat(node.props?.children||[]).flat(Infinity).flatMap(child=>nodes(child,predicate))];}
function render(){h.cursor=0;h.refCursor=0;return View();}
async function loaded(){render();h.effects[0]();h.effects[1]();await vi.waitFor(()=>expect(h.values[4]).not.toBeNull());return render();}
beforeEach(()=>{Object.assign(h,{values:[],refs:[],effects:[],identity:'first',denied:[]});h.fetch.mockReset();h.fetch.mockImplementation(async url=>Response.json(url.includes('/context')?{success:true,can_manage:true,sites:[]}:{success:true,sessions:[{id:'session',started_at:'today',ended_at:'later',work_seconds:60,user_id:'person',user_type:'developer'}],nextCursor:null}));});
it('hides loaded GPS session rows immediately when identity changes',async()=>{expect(nodes(await loaded(),n=>n.type==='article')).toHaveLength(1);h.identity='second';expect(nodes(render(),n=>n.type==='article')).toHaveLength(0);});
it('invalidates visible results when monitoring permissions change',async()=>{await loaded();h.denied=['monitoring.view'];expect(nodes(render(),n=>n.type==='article')).toHaveLength(0);});
it('clears loaded history on auth events',async()=>{await loaded();h.authChanged();expect(nodes(render(),n=>n.type==='article')).toHaveLength(0);});
