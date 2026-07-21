// Example: How to use the 'reviewed' status in your admin review API
// File: src/app/api/admin-review/route.js

// OPTION 1: Use 'reviewed' as an intermediate state
// When admin reviews but doesn't approve/reject immediately

// Add this to your POST handler after reviewing a task:
if (action === 'review') {
  // Just mark as reviewed, admin can approve/reject later
  newStatus = 'reviewed';
  productivityPoints = 0; // No points yet
} else if (action === 'approve') {
  newStatus = 'completed';
  productivityPoints = isOnTime ? 1 : -1;
} else if (action === 'reject') {
  newStatus = 'rejected';
  productivityPoints = 0;
}

// OPTION 2: Automatically set to 'reviewed' when admin opens the review panel
// This marks that someone has looked at it

// Example endpoint to mark tasks as reviewed:
export async function PATCH(request) {
  try {
    const { taskId, adminId } = await request.json();

    const { error } = await supabase
      .from('developer_tasks')
      .update({
        status: 'reviewed',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('status', 'awaiting_approval'); // Only update if still awaiting

    if (error) {
      return NextResponse.json(
        { error: 'Failed to mark as reviewed: ' + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// OPTION 3: Set status directly when submitting review
// If you want to explicitly set status to 'reviewed' in your current code:

// In your existing admin review POST handler, you can add:
const { action } = await request.json(); // action can be 'review', 'approve', 'reject'

let newStatus;
if (action === 'reviewed') {
  newStatus = 'reviewed'; // Mark as reviewed without approving/rejecting
} else if (action === 'approve') {
  newStatus = 'completed';
} else if (action === 'reject') {
  newStatus = 'rejected';
}
