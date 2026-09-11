-- Read-only deployment check. Review legacy rows; do not silently delete or
-- reassign relationships. NOT VALID constraints enforce all new references.
select t.id as task_id,t.organization_id,t.project_id,'parent' as relation,t.parent_task_id as target_id
from public.developer_tasks t left join public.developer_tasks p on p.id=t.parent_task_id
where t.parent_task_id is not null and (p.id is null or p.id=t.id or p.organization_id is distinct from t.organization_id or p.project_id is distinct from t.project_id)
union all
select t.id,t.organization_id,t.project_id,'sprint',t.sprint_id
from public.developer_tasks t left join public.sprints s on s.id=t.sprint_id
where t.sprint_id is not null and (s.id is null or s.organization_id is distinct from t.organization_id or (s.project_id is not null and s.project_id is distinct from t.project_id))
union all
select t.id,t.organization_id,t.project_id,'epic',t.epic_id
from public.developer_tasks t left join public.epics e on e.id=t.epic_id
where t.epic_id is not null and (e.id is null or e.organization_id is distinct from t.organization_id or (e.project_id is not null and e.project_id is distinct from t.project_id));

with recursive ancestry(root_task_id,organization_id,project_id,id,parent_task_id,path,cycle) as (
 select t.id,t.organization_id,t.project_id,t.id,t.parent_task_id,array[t.id],false
 from public.developer_tasks t where t.parent_task_id is not null
 union all
 select a.root_task_id,a.organization_id,a.project_id,p.id,p.parent_task_id,a.path||p.id,p.id=any(a.path)
 from ancestry a join public.developer_tasks p on p.id=a.parent_task_id
 where not a.cycle and p.organization_id=a.organization_id and p.project_id=a.project_id
)
select distinct root_task_id,organization_id,project_id from ancestry where cycle;
