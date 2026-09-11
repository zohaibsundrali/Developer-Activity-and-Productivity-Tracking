import { expect,it } from 'vitest';
import { proposalProjectHistory } from '@/utils/proposalProjectHistory';
it('retains accepted verdict while explaining deleted project provenance without a live link',()=>{expect(proposalProjectHistory({status:'accepted',project_id:null,deleted_project_id:'former',deleted_project_name:'Client portal',project_deleted_at:'2026-09-11T12:00:00Z'})).toBe('Accepted. Project "Client portal" was deleted on 2026-09-11. The accepted proposal remains in your history.');});
it('does not imply deletion or acceptance from incomplete history',()=>{expect(proposalProjectHistory({status:'pending',deleted_project_id:'former',project_deleted_at:'2026-09-11'})).toBeNull();expect(proposalProjectHistory({status:'accepted'})).toBe('Accepted. The project has been created.');});
it('does not render invalid deletion dates',()=>{expect(proposalProjectHistory({status:'accepted',deleted_project_id:'former',project_deleted_at:'bad'})).not.toContain('Invalid');});
