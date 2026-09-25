import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
globalThis.React=React;
vi.mock('@/utils/orgContext',()=>({getOrgId:()=> 'org',getOrgContext:()=>({userId:'same',userType:'admin',organizationId:'org'})}));
vi.mock('@/utils/permissions',()=>({allowed:()=>false}));
vi.mock('@/components/charts/EChart',()=>({default:()=>null}));
import KanbanView from '@/components/admin/views/KanbanView';
import ListView from '@/components/admin/views/ListView';
import TableView from '@/components/admin/views/TableView';
import WorkloadView from '@/components/admin/views/WorkloadView';
const employees=[{userId:'same',userType:'developer',name:'Employee Alpha'},{userId:'same',userType:'admin',name:'Owner Beta'}];
const tasks=[{id:'owner-task',task_title:'Owner task',assignee_admin_id:'same',status:'pending',priority:'medium',story_points:3}];
it.each([['Kanban',KanbanView],['List',ListView],['Table',TableView],['Workload',WorkloadView]])('%s renders owner assignment instead of unassigned or a colliding employee',(_,View)=>{
 const html=renderToStaticMarkup(React.createElement(View,{tasks,employees,sprints:[],epics:[]}));
 expect(html).toContain('Owner Beta');
 expect(html).not.toContain('Employee Alpha');
});
