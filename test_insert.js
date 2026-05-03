const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  const { data: task } = await supabase.from('developer_tasks').select('*').limit(1).single();
  const { data: sub } = await supabase.from('task_submissions').select('*').limit(1).single();
  const { data: proj } = await supabase.from('projects').select('*').limit(1).single();
  
  if (!task || !sub) {
    console.log("No data");
    return;
  }

  const { data, error } = await supabase.from('admin_reviews').insert({
        admin_id: proj.admin_id,
        admin_email: 'test@example.com',
        admin_name: 'Admin Test',
        task_id: task.id,
        submission_id: sub.id,
        project_id: task.project_id,
        developer_id: task.developer_id,
        review_action: 'approved',
        review_comments: 'Test',
        rejection_reason: null,
        task_title: task.task_title,
        developer_name: null,
        project_name: null,
        submission_file_url: sub.file_url,
        deadline: task.end_date,
        submission_date: sub.submitted_at,
        reviewed_at: new Date().toISOString()
  }).select();

  console.log('Error:', error);
  console.log('Data:', data);
}

test();
