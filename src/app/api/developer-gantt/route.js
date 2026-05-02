import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function getCookieValue(request, name) {
  try {
    const viaCookiesApi = request?.cookies?.get?.(name);
    if (viaCookiesApi?.value) return viaCookiesApi.value;
    if (typeof viaCookiesApi === 'string') return viaCookiesApi;
  } catch {
    // ignore
  }

  const cookieHeader = request?.headers?.get?.('cookie') || '';
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(';').map((p) => p.trim());
  for (const part of parts) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(eqIdx + 1));
  }
  return null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const developerIdParam = searchParams.get('developerId');

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'Missing projectId' }, { status: 400 });
    }

    // Authorize strictly as developer. Note: admin_auth may coexist in the same browser;
    // for this endpoint we only care that developer_auth + developer_id are present.
    const isDeveloperViewer = Boolean(getCookieValue(request, 'developer_auth'));
    const developerId = developerIdParam || getCookieValue(request, 'developer_id');

    if (!isDeveloperViewer || !developerId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Enforce project assignment
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, name, description, deadline, progress, status, assigned_developer_id')
      .eq('id', projectId)
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
