import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({values:[],refs:[],effects:[],cursor:0,refCursor:0,identity:'first',denied:[],fetch:vi.fn(),authChanged:null}));
vi.mock('react',async()=>({...await vi.importActual('react'),useState:initial=>{const i=h.cursor++;if(!(i in h.values))h.values[i]=typeof initial==='function'?initial():initial;return[h.values[i],value=>{h.values[i]=typeof value==='function'?value(h.values[i]):value;}];},useRef:initial=>{const i=h.refCursor++;return h.refs[i]||={current:initial};},useEffect:callback=>{h.effects.push(callback);}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({authStatus:'authenticated'})}));
vi.mock('@/utils/orgContext',()=>({getOrgContext:()=>({identity:h.identity})}));
vi.mock('@/utils/reportViewState',()=>({reportIdentity:value=>value.identity}));
vi.mock('@/utils/permissions',()=>({allowed:key=>!h.denied.includes(key)}));
vi.mock('@/utils/supabaseClient',()=>({supabase:{auth:{onAuthStateChange:callback=>{h.authChanged=callback;return{data:{subscription:{unsubscribe(){}}}};}}}}));
vi.mock('@/utils/authFetch',()=>({authFetch:h.fetch}));vi.mock('@/components/ui',()=>({Button:'button'}));
globalThis.React=await vi.importActual('react');
const {default:View}=await import('@/components/shared/ShiftAttendanceExceptions');
function nodes(node,predicate){if(!node||typeof node!=='object')return[];return[...(predicate(node)?[node]:[]),...[].concat(node.props?.children||[]).flat(Infinity).flatMap(child=>nodes(child,predicate))];}
function render(){h.cursor=0;h.refCursor=0;return View();}
async function loaded(){render();h.effects[0]();h.effects[1]();await vi.waitFor(()=>expect(h.values[6]).not.toBeNull());return render();}
beforeEach(()=>{Object.assign(h,{values:[],refs:[],effects:[],identity:'first',denied:[]});h.fetch.mockReset();h.fetch.mockResolvedValue(Response.json({success:true,can_manage:true,rows:[{snapshot:{shift:{id:'shift',assignee_name:'Person',title:'Day',start_at:'start',end_at:'end',timezone:'UTC'},attendance:[],leave:[]},classification:{flags:['missed_shift'],late_seconds:0,early_seconds:0,reason:'No clock'},reviews:[],review_state:'unreviewed'}]}));});
it('defaults both grace periods to five minutes',async()=>{await loaded();expect(h.fetch.mock.calls[0][0]).toContain('late=5&early=5');});
it('hides prior account evidence immediately',async()=>{expect(nodes(await loaded(),n=>n.type==='article')).toHaveLength(1);h.identity='second';expect(nodes(render(),n=>n.type==='article')).toHaveLength(0);});
it('invalidates evidence and management controls on permission change',async()=>{await loaded();h.denied=['attendance.manage'];expect(nodes(render(),n=>n.type==='article')).toHaveLength(0);});
it('drops outstanding evidence after auth events',async()=>{await loaded();h.authChanged();expect(nodes(render(),n=>n.type==='article')).toHaveLength(0);});
