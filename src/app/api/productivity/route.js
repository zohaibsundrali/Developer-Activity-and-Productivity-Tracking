import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

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
    const { searchParams } = new URL(request.url);
    const developerId = searchParams.get('developerId');
    const projectId = searchParams.get('projectId');
    const type = searchParams.get('type') || 'project'; // 'project', 'developer', 'overall'

    // Project-specific productivity
    if (type === 'project' && projectId) {
      const productivity = await calculateProjectProductivity(projectId, developerId);
      return NextResponse.json({ success: true, ...productivity });
    }

    // Developer's overall productivity
    if (type === 'developer' && developerId) {
      const productivity = await calculateDeveloperProductivity(developerId);
      return NextResponse.json({ success: true, ...productivity });
    }

    // Overall system productivity (admin view)
    if (type === 'overall') {
      const productivity = await calculateOverallProductivity();
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
async function calculateProjectProductivity(projectId, developerId = null) {
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
async function calculateDeveloperProductivity(developerId) {
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
async function calculateOverallProductivity() {
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

  // Calculate productivity for each developer
  const developersBreakdown = await Promise.all(
    developers.map(async (dev) => {
      const { data: tasks } = await supabase
        .from('developer_tasks')
        .select('status, is_on_time, project_id')
        .eq('developer_id', dev.id);

      const allTasks = tasks || [];
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
          const productivity = await calculateProjectProductivity(pid, dev.id);
          
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
      const productivity = await calculateProjectProductivity(projectId, developerId);
      
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
