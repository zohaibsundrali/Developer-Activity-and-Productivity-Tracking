import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const activities = await request.json();

    const { data, error } = await supabase
      .from('developer_activities')
      .insert(activities)
      .select();

    if (error) throw error;

    // Calculate productivity score for each activity
    for (let activity of activities) {
      await calculateProductivityScore(activity);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Activities tracked successfully',
      count: activities.length 
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to track activities' },
      { status: 500 }
    );
  }
}

async function calculateProductivityScore(activity) {
  let score = 0;
  
  switch (activity.activity_type) {
    case 'keyboard':
      score = 0.8; // High productivity
      break;
    case 'mouse':
      score = 0.6; // Medium productivity
      break;
    case 'app_switch':
      const app = activity.activity_data.application?.toLowerCase();
      if (isProductiveApp(app)) {
        score = 0.9;
      } else {
        score = 0.3;
      }
      break;
    case 'idle':
      score = 0.1; // Low productivity
      break;
    default:
      score = 0.5;
  }
  
  // Update activity with productivity score
  await supabase
    .from('developer_activities')
    .update({ productivity_score: score })
    .eq('id', activity.id);
}

function isProductiveApp(appName) {
  const productiveApps = [
    'vscode', 'code', 'sublime', 'pycharm', 'webstorm', 'intellij',
    'terminal', 'cmd', 'powershell', 'bash', 'git', 'github',
    'visual studio', 'eclipse', 'android studio'
  ];
  
  return productiveApps.some(prodApp => 
    appName?.includes(prodApp)
  );
}