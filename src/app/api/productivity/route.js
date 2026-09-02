import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { authCan, requirePermission } from '@/utils/serverPermissions';

/**
 * PRODUCTIVITY CALCULATION API
 * 
 * Formula:
 * - Each task has weight = 100% / total_tasks
 * - Task completed ON TIME = +weight (adds to productivity)
 * - Task completed LATE = -weight (subtracts from productivity)
 * - Base productivity starts at potential 100%
 * 
 * Example with 4 tasks:
 * - Each task weight = 25%
 * - Task 1: On time = +25%
 * - Task 2: Late = -25%
 * - Task 3: On time = +25%
 * - Task 4: On time = +25%
 * - Final: 75% productivity (3 on-time - 1 late)
 */

// Get productivity metrics
export async function GET(request) {
  try {
    // Authenticate the caller; the JWT is the source of truth for org + role.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // All queries run through an org-scoped client, so RLS guarantees the
    // caller can only ever read their own organization's data.
    const supabase = orgScopedClient(auth.token);

    const { searchParams } = new URL(request.url);
    const developerId = searchParams.get('developerId');
    const projectId = searchParams.get('projectId');
    const type = searchParams.get('type') || 'project'; // 'project', 'developer', 'overall'

    // TWO KEYS, NOT A STORAGE COLUMN.
    //
    // These were `auth.userType === 'admin'` and `=== 'developer'`, and
    // userType is which profile table the row lives in, not what the person may
    // do: userTypeForRole() files nine of the twelve roles under "developer".
    // A manager and a team lead therefore came out as `isDeveloperViewer`, were
    // pinned to their own id, and were refused `type=overall` outright — while
    // the catalogue grants both of them `report.view`, the key that means
    // exactly "open reports". Delivery metrics for their own team were
    // unreachable to the two roles whose job is to read them.
    //
    // WIDENING, STATED PLAINLY: manager and team_lead gain org-wide
    // productivity here. That is `report.view`'s definition and it is what
    // SUPERVISORS has meant everywhere else since the catalogue was written.
    // It does NOT hand them the monitoring surface — screenshots and keystrokes
    // sit behind `monitoring.view`, which is owner+admin, and this route does
    // not read them.
    const isAdminViewer = authCan(auth, 'report.view');
    const isDeveloperViewer = !isAdminViewer && authCan(auth, 'productivity.view_own');

    // NEITHER KEY IS NOW A REFUSAL, and it used to be a fall-through.
    //
    // Both flags were false for a client, and nothing below tested for that:
    // `effectiveDeveloperId` fell back to the developerId in the QUERY STRING
    // and the `type=overall` refusal was written as `isDeveloperViewer && ...`,
    // so a client reached the org-wide branch unscoped. RLS saved it — the
    // org-scoped client reads nothing a client may not see, and track_read
    // carries `not public.auth_is_client()` — which is why this was an empty
    // result rather than a leak. A route should not depend on the last gate to
    // cover for the absence of the first one.
    if (!isAdminViewer && !isDeveloperViewer) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // A developer viewer is always scoped to their own identity (from the JWT),
    // never to a developerId supplied in the query string.
    const effectiveDeveloperId = isDeveloperViewer ? auth.appUserId : developerId;

    if (isDeveloperViewer && !effectiveDeveloperId) {
      return NextResponse.json(
        { error: 'Unauthorized: developer session missing.' },
        { status: 401 }
      );
    }

    // Developers cannot access overall/global metrics
    if (isDeveloperViewer && type === 'overall') {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Project-specific productivity
    if (type === 'project' && projectId) {
      // Enforce: developers can only see metrics for projects assigned to them
      if (isDeveloperViewer) {
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .select('id, assigned_developer_id')
          .eq('id', projectId)
          .single();

        if (projectError || !project) {
          return NextResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          );
        }

        if (!project.assigned_developer_id || String(project.assigned_developer_id) !== String(effectiveDeveloperId)) {
          return NextResponse.json(
            { error: 'Forbidden' },
            { status: 403 }
          );
        }
      }

      const productivity = await calculateProjectProductivity(supabase, projectId, effectiveDeveloperId);
      return NextResponse.json({ success: true, ...productivity });
    }

    // Developer's overall productivity
    if (type === 'developer' && effectiveDeveloperId) {
      const productivity = await calculateDeveloperProductivity(supabase, effectiveDeveloperId);
      return NextResponse.json({ success: true, ...productivity });
    }

    // Overall system productivity (admin view)
    if (type === 'overall') {
      const productivity = await calculateOverallProductivity(supabase);
      return NextResponse.json({ success: true, ...productivity });
    }

    return NextResponse.json(
      { error: 'Invalid request. Provide developerId or projectId with type.' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Productivity calculation error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}

// Calculate productivity for a specific project
async function calculateProjectProductivity(supabase, projectId, developerId = null) {
  let query = supabase
    .from('developer_tasks')
    .select(`
      *,
      developers (name, email),
      projects (name, deadline)
    `)
    .eq('project_id', projectId);

  if (developerId) {
    query = query.eq('developer_id', developerId);
  }

  const { data: tasks, error } = await query;

  if (error) throw error;

  const totalTasks = tasks?.length || 0;
  
  if (totalTasks === 0) {
    return {
      projectId,
      totalTasks: 0,
      taskWeight: 0,
      tasksBreakdown: [],
      productivityPercentage: 0,
      productivityPoints: 0,
      summary: {
        completed: 0,
        onTime: 0,
        late: 0,
        pending: 0,
        awaiting: 0,
        rejected: 0
      }
    };
  }

  const taskWeight = 100 / totalTasks;
  
  // Calculate breakdown
  const completed = tasks.filter(t => t.status === 'completed');
  const onTime = completed.filter(t => t.is_on_time === true);
  const late = completed.filter(t => t.is_on_time === false);
  const pending = tasks.filter(t => t.status === 'pending');
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const awaiting = tasks.filter(t => t.status === 'awaiting_approval');
  const rejected = tasks.filter(t => t.status === 'rejected');

  // Calculate productivity
  // Formula: (onTime tasks * weight) - (late tasks * weight)
  const earnedPoints = onTime.length;
  const lostPoints = late.length;
  const productivityPoints = earnedPoints - lostPoints;
  
  // Percentage calculation based on completed tasks only
  let productivityPercentage;
  if (completed.length > 0) {
    productivityPercentage = (onTime.length / completed.length) * 100;
  } else {
    productivityPercentage = 0; // No completed tasks yet
  }

  // Alternative calculation: Based on all tasks
  // Each on-time adds weight, each late subtracts weight
  const potentialProductivity = totalTasks * taskWeight; // 100%
  const actualProductivity = (onTime.length * taskWeight) - (late.length * taskWeight);
  const overallProductivityPercentage = Math.max(0, Math.min(100, 
    (actualProductivity / potentialProductivity) * 100 + 
    ((pending.length + inProgress.length + awaiting.length) * taskWeight * 0.5) // Pending counts as half potential
  ));

  // Task-by-task breakdown
  const tasksBreakdown = tasks.map(task => {
    let contribution = 0;
    let contributionLabel = '';
    
    if (task.status === 'completed') {
      if (task.is_on_time) {
        contribution = taskWeight;
        contributionLabel = `+${taskWeight.toFixed(1)}%`;
      } else {
        contribution = -taskWeight;
        contributionLabel = `-${taskWeight.toFixed(1)}%`;
      }
    } else if (task.status === 'rejected') {
      contribution = 0;
      contributionLabel = '0% (Rejected)';
    } else {
      contribution = 0;
      contributionLabel = 'Pending';
    }

    return {
      id: task.id,
      title: task.task_title,
      status: task.status,
      startDate: task.start_date,
      endDate: task.end_date,
      submittedAt: task.submitted_at,
      actualCompletionDate: task.actual_completion_date,
      isOnTime: task.is_on_time,
      productivityPoints: task.productivity_points,
      weight: taskWeight.toFixed(2),
      contribution,
      contributionLabel
    };
  });

  return {
    projectId,
    projectName: tasks[0]?.projects?.name,
    totalTasks,
    taskWeight: taskWeight.toFixed(2),
    tasksBreakdown,
    productivityPercentage: productivityPercentage.toFixed(2),
    overallProductivityPercentage: overallProductivityPercentage.toFixed(2),
    productivityPoints,
    completionProgress: ((completed.length / totalTasks) * 100).toFixed(2),
    summary: {
      completed: completed.length,
      onTime: onTime.length,
      late: late.length,
      pending: pending.length,
      inProgress: inProgress.length,
      awaiting: awaiting.length,
      rejected: rejected.length
    },
    formula: {
      description: 'Productivity = (On-time tasks × weight) - (Late tasks × weight)',
      calculation: `(${onTime.length} × ${taskWeight.toFixed(1)}%) - (${late.length} × ${taskWeight.toFixed(1)}%) = ${actualProductivity.toFixed(1)}%`,
      example: `With ${totalTasks} tasks, each task = ${taskWeight.toFixed(1)}% weight`
    }
  };
}

// Calculate developer's overall productivity across all projects
async function calculateDeveloperProductivity(supabase, developerId) {
  // Get all tasks for this developer
  const { data: tasks, error } = await supabase
    .from('developer_tasks')
    .select(`
      *,
      projects (id, name, deadline)
    `)
    .eq('developer_id', developerId);

  if (error) throw error;

  // Get developer info
  const { data: developer } = await supabase
    .from('developers')
    .select('name, email')
    .eq('id', developerId)
    .single();

  const allTasks = tasks || [];
  const totalTasks = allTasks.length;

  if (totalTasks === 0) {
    return {
      developerId,
      developerName: developer?.name,
      totalProjects: 0,
      totalTasks: 0,
      productivityPercentage: 0,
      projectsBreakdown: []
    };
  }

  // Group by project
  const projectGroups = {};
  allTasks.forEach(task => {
    const pid = task.project_id;
    if (!projectGroups[pid]) {
      projectGroups[pid] = {
        projectId: pid,
        projectName: task.projects?.name,
        tasks: []
      };
    }
    projectGroups[pid].tasks.push(task);
  });

  // Calculate per-project productivity
  const projectsBreakdown = Object.values(projectGroups).map(group => {
    const total = group.tasks.length;
    const completed = group.tasks.filter(t => t.status === 'completed');
    const onTime = completed.filter(t => t.is_on_time === true).length;
    const late = completed.filter(t => t.is_on_time === false).length;
    const weight = 100 / total;
    
    const productivity = completed.length > 0 
      ? ((onTime / completed.length) * 100).toFixed(2)
      : 0;

    return {
      projectId: group.projectId,
      projectName: group.projectName,
      totalTasks: total,
      completed: completed.length,
      onTime,
      late,
      pending: group.tasks.filter(t => ['pending', 'in_progress', 'awaiting_approval'].includes(t.status)).length,
      productivityPercentage: productivity
    };
  });

  // Overall developer productivity
  const allCompleted = allTasks.filter(t => t.status === 'completed');
  const allOnTime = allCompleted.filter(t => t.is_on_time === true).length;
  const allLate = allCompleted.filter(t => t.is_on_time === false).length;
  
  const overallProductivity = allCompleted.length > 0
    ? ((allOnTime / allCompleted.length) * 100).toFixed(2)
    : 0;

  return {
    developerId,
    developerName: developer?.name,
    developerEmail: developer?.email,
    totalProjects: Object.keys(projectGroups).length,
    totalTasks,
    totalCompleted: allCompleted.length,
    totalOnTime: allOnTime,
    totalLate: allLate,
    totalPending: allTasks.filter(t => ['pending', 'in_progress', 'awaiting_approval'].includes(t.status)).length,
    productivityPercentage: overallProductivity,
    productivityPoints: allOnTime - allLate,
    projectsBreakdown
  };
}

// Calculate overall system productivity (all developers)
async function calculateOverallProductivity(supabase) {
  // Get all developers
  const { data: developers } = await supabase
    .from('developers')
    .select('id, name, email');

  if (!developers || developers.length === 0) {
    return {
      totalDevelopers: 0,
      totalProjects: 0,
      totalTasks: 0,
      averageProductivity: 0,
      developersBreakdown: []
    };
  }

  // One query for the whole organization instead of one per developer.
  //
  // This mapped over every developer and issued a query inside the loop, so an
  // organization with 500 people cost 501 round trips in a single request — the
  // kind of shape that is fine in development and times out in production.
  // Tasks are fetched once and grouped in memory.
  const developerIds = developers.map((d) => d.id);
  const tasksByDeveloper = new Map();
  if (developerIds.length) {
    const { data: allOrgTasks } = await supabase
      .from('developer_tasks')
      .select('status, is_on_time, project_id, developer_id')
      .in('developer_id', developerIds);
    for (const t of allOrgTasks || []) {
      const bucket = tasksByDeveloper.get(t.developer_id);
      if (bucket) bucket.push(t);
      else tasksByDeveloper.set(t.developer_id, [t]);
    }
  }

  const developersBreakdown = await Promise.all(
    developers.map(async (dev) => {
      const allTasks = tasksByDeveloper.get(dev.id) || [];
      const completed = allTasks.filter(t => t.status === 'completed');
      const onTime = completed.filter(t => t.is_on_time === true).length;
      const late = completed.filter(t => t.is_on_time === false).length;
      const uniqueProjects = [...new Set(allTasks.map(t => t.project_id))];

      const productivity = completed.length > 0
        ? ((onTime / completed.length) * 100)
        : 0;

      return {
        developerId: dev.id,
        developerName: dev.name,
        developerEmail: dev.email,
        totalProjects: uniqueProjects.length,
        totalTasks: allTasks.length,
        completedTasks: completed.length,
        onTimeTasks: onTime,
        lateTasks: late,
        productivityPercentage: productivity.toFixed(2),
        productivityPoints: onTime - late
      };
    })
  );

  // Sort by productivity
  developersBreakdown.sort((a, b) => 
    parseFloat(b.productivityPercentage) - parseFloat(a.productivityPercentage)
  );

  // Calculate averages
  const totalTasks = developersBreakdown.reduce((sum, d) => sum + d.totalTasks, 0);
  const totalCompleted = developersBreakdown.reduce((sum, d) => sum + d.completedTasks, 0);
  const totalOnTime = developersBreakdown.reduce((sum, d) => sum + d.onTimeTasks, 0);
  const avgProductivity = developersBreakdown.length > 0
    ? developersBreakdown.reduce((sum, d) => sum + parseFloat(d.productivityPercentage), 0) / developersBreakdown.length
    : 0;

  // Get unique projects count
  const { count: projectsCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true });

  return {
    totalDevelopers: developers.length,
    totalProjects: projectsCount || 0,
    totalTasks,
    totalCompleted,
    totalOnTime,
    averageProductivity: avgProductivity.toFixed(2),
    highestProductivity: developersBreakdown[0] || null,
    lowestProductivity: developersBreakdown[developersBreakdown.length - 1] || null,
    developersBreakdown
  };
}

// Recalculate and update productivity metrics (can be called after task changes)
export async function POST(request) {
  try {
    // Only authenticated admins may trigger a recalculation, and it runs through
    // an org-scoped client so it only ever touches the caller's own org.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // `userType !== 'admin'` meant owner+admin, which is what ADMINS is. Named
    // as a key so an override can move it and so the check is legible next to
    // every other one in the product.
    const denied = requirePermission(auth, 'productivity.recalculate');
    if (denied) return denied;
    const supabase = orgScopedClient(auth.token);

    const body = await request.json();
    const { developerId, projectId, recalculateAll } = body;

    if (recalculateAll) {
      // Recalculate for all developers and projects
      const { data: developers } = await supabase
        .from('developers')
        .select('id');

      for (const dev of (developers || [])) {
        const { data: projects } = await supabase
          .from('developer_tasks')
          .select('project_id')
          .eq('developer_id', dev.id);

        const uniqueProjects = [...new Set(projects?.map(p => p.project_id) || [])];
        
        for (const pid of uniqueProjects) {
          const productivity = await calculateProjectProductivity(supabase, pid, dev.id);
          
          await supabase
            .from('productivity_metrics')
            .upsert({
              developer_id: dev.id,
              project_id: pid,
              total_tasks: productivity.totalTasks,
              completed_on_time: productivity.summary.onTime,
              completed_late: productivity.summary.late,
              pending_tasks: productivity.summary.pending + productivity.summary.inProgress + productivity.summary.awaiting,
              rejected_tasks: productivity.summary.rejected,
              productivity_percentage: productivity.productivityPercentage,
              productivity_points: productivity.productivityPoints,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'developer_id,project_id'
            });
        }
      }

      return NextResponse.json({
        success: true,
        message: 'All productivity metrics recalculated'
      });
    }

    if (developerId && projectId) {
      const productivity = await calculateProjectProductivity(supabase, projectId, developerId);
      
      await supabase
        .from('productivity_metrics')
        .upsert({
          developer_id: developerId,
          project_id: projectId,
          total_tasks: productivity.totalTasks,
          completed_on_time: productivity.summary.onTime,
          completed_late: productivity.summary.late,
          pending_tasks: productivity.summary.pending + productivity.summary.inProgress + productivity.summary.awaiting,
          rejected_tasks: productivity.summary.rejected,
          productivity_percentage: productivity.productivityPercentage,
          productivity_points: productivity.productivityPoints,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'developer_id,project_id'
        });

      return NextResponse.json({
        success: true,
        message: 'Productivity metrics updated',
        productivity
      });
    }

    return NextResponse.json(
      { error: 'Provide developerId and projectId, or set recalculateAll to true' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Productivity update error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
