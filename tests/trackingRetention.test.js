import { describe,it,expect,vi } from 'vitest';
import { runTrackingRetention } from '@/utils/trackingRetention';
function service({ providerError=false, completed=true, job={id:'job',lease:'lease',bucket:'monitoring',path:'org/dev/file',remove:true} }={}) {
  const rpc=vi.fn().mockResolvedValueOnce({data:[{organization_id:'org'}]}).mockResolvedValueOnce({data:{deleted:2,skipped:1}})
    .mockResolvedValueOnce({data:job}).mockResolvedValueOnce({data:completed}).mockResolvedValue({data:null});
  const remove=vi.fn().mockResolvedValue({error:providerError?new Error('secret provider body'):null});
  return {rpc,storage:{from:vi.fn(()=>({remove}))},remove};
}
describe('tracking retention provider reconciliation',()=>{
 it('removes only the claimed canonical object and finalizes via database',async()=>{const svc=service();const r=await runTrackingRetention(svc);expect(svc.remove).toHaveBeenCalledWith(['org/dev/file']);expect(svc.rpc).toHaveBeenCalledWith('finish_retention_file',{p_job:'job',p_lease:'lease',p_error:null});expect(r).toMatchObject({deletedRecords:2,removedFiles:1,skipped:1,errors:[]});});
 it('retains recovery when provider and database cannot confirm removal',async()=>{const svc=service({providerError:true,completed:false});const r=await runTrackingRetention(svc);expect(r.removedFiles).toBe(0);expect(r.errors).toHaveLength(1);expect(JSON.stringify(r)).not.toContain('secret provider body');});
 it('reconciles a provider timeout that actually deleted the object',async()=>{const svc=service({providerError:true,completed:true});expect((await runTrackingRetention(svc)).removedFiles).toBe(1);});
 it.each([{bucket:'documents',path:'org/dev/file'},{bucket:'monitoring',path:'foreign/dev/file'}])('refuses unsafe claims %j',async bad=>{const svc=service({job:{id:'j',lease:'l',remove:true,...bad}});const r=await runTrackingRetention(svc);expect(svc.remove).not.toHaveBeenCalled();expect(r.errors).toHaveLength(1);});
 it('finalizes absent bytes without another provider deletion',async()=>{const svc=service({job:{id:'j',lease:'l',bucket:'monitoring',path:'org/dev/file',remove:false}});expect((await runTrackingRetention(svc)).removedFiles).toBe(1);expect(svc.remove).not.toHaveBeenCalled();});
 it('does not process unconfigured organizations when scheduler returns none',async()=>{const svc=service();svc.rpc.mockReset().mockResolvedValue({data:[]});expect((await runTrackingRetention(svc)).organizations).toBe(0);expect(svc.remove).not.toHaveBeenCalled();});
});
