import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg } from '@/utils/serverAuth';
import { authCan } from '@/utils/serverPermissions';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const developerIdParam = searchParams.get('developerId');

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'Missing projectId' }, { status: 400 });
    }

    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let developerId;
    if (auth.userType === 'developer') {
      // A developer can only ever view their own gantt chart — never trust a
      // developerId supplied via query string.
      developerId = auth.appUserId;
    } else if (authCan(auth, "project.view_all")) {
      developerId = developerIdParam;
      if (!developerId) {
        return NextResponse.json({ success: false, error: 'Missing developerId' }, { status: 400 });
      }
      // Verify the requested developer belongs to the caller's organization.
      const { data: devCheck, error: devCheckError } = await supabase
        .from('developers')
        .select('id')
        .eq('id', developerId)
        .eq('organization_id', auth.orgId)
        .maybeSingle();

      if (devCheckError || !devCheck) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Enforce project assignment
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, name, description, deadline, progress, status, assigned_developer_id')
      .eq('id', projectId)
      .eq('organization_id', auth.orgId)
      .single();

    if (projectError) {
      return NextResponse.json(
        { success: false, error: projectError.message || 'Failed to load project' },
        { status: 500 }
      );
    }

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    if (!project.assigned_developer_id || String(project.assigned_developer_id) !== String(developerId)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Fetch only tasks assigned to this developer for this project
    const { data: tasks, error: tasksError } = await supabase
      .from('developer_tasks')
      .select(
        `
          *,
          developer:developers (
            id,
            name,
            email
          )
        `
      )
      .eq('project_id', projectId)
      .eq('developer_id', developerId)
      .eq('organization_id', auth.orgId)
      .order('task_order', { ascending: true });

    if (tasksError) {
      return NextResponse.json(
        { success: false, error: tasksError.message || 'Failed to load tasks' },
        { status: 500 }
      );
    }

    // Fetch developer profile (for header + chart legend)
    const { data: developer, error: developerError } = await supabase
      .from('developers')
      .select('id, name, email')
      .eq('id', developerId)
      .single();

    if (developerError) {
      // Non-fatal: chart can still render without this
      return NextResponse.json({ success: true, project, tasks: tasks || [], developer: null });
    }

    return NextResponse.json({ success: true, project, tasks: tasks || [], developer: developer || null });
  } catch (error) {
    console.error('Developer gantt API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
