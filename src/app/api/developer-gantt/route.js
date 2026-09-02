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

    // THE PERMISSION IS ASKED FIRST, AND IT DID NOT USED TO BE.
    //
    // This block opened with `if (auth.userType === 'developer')`, which self-
    // scoped the caller and returned. `user_type` is a STORAGE column — it says
    // which profile table the row lives in — and userTypeForRole() files nine
    // of the twelve roles under "developer": manager, hr, finance, team_lead,
    // qa, developer, designer, devops and employee. So a manager and a team
    // lead, both of whom the catalogue grants `project.view_all`, hit the first
    // branch every time and could never open anybody's chart but their own. The
    // `else if` under it was unreachable for them.
    //
    // Asking the wide key first and falling back to the narrow one is what the
    // paired keys exist for. Nobody loses anything: a developer holds
    // project.view_own and not project.view_all, so they still self-scope — now
    // because a permission says so rather than because of where their row is
    // stored.
    const wantsSomeoneElse =
      developerIdParam && String(developerIdParam) !== String(auth.appUserId);

    let developerId;
    if (wantsSomeoneElse) {
      if (!authCan(auth, 'project.view_all')) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      developerId = developerIdParam;
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
      if (!authCan(auth, 'project.view_own')) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      // Their own chart, from the token — never from the query string.
      developerId = auth.appUserId;
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
