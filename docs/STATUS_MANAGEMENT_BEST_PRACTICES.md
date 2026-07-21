# Task Status Management - Best Practices

## 📊 Status Workflow

### Current Status Values (After Migration)
```
1. pending           - Task assigned, not started
2. in_progress       - Developer actively working
3. awaiting_approval - Developer submitted, waiting for review
4. reviewed          - Admin reviewed, pending final decision
5. completed         - Admin approved (final state)
6. rejected          - Admin rejected (final state)
```

## 🔄 Recommended Status Transitions

### Standard Workflow
```
pending → in_progress → awaiting_approval → reviewed → completed
                                                     ↘
                                                      rejected
```

### Valid Transitions Matrix

| From Status        | Can Change To                                              |
|--------------------|------------------------------------------------------------|
| pending            | in_progress, rejected (cancelled)                          |
| in_progress        | awaiting_approval, pending (restart)                       |
| awaiting_approval  | reviewed, completed, rejected, in_progress (sent back)     |
| reviewed           | completed, rejected, awaiting_approval (needs more review) |
| completed          | ❌ Final state (no changes)                                |
| rejected           | pending (reassign), in_progress (fix and retry)            |

## ✅ Best Practices

### 1. **Use Atomic Status Updates**
Always update status along with related fields:
```javascript
// ✅ GOOD - Update all related fields together
await supabase
  .from('developer_tasks')
  .update({
    status: 'completed',
    is_on_time: true,
    productivity_points: 1,
    actual_completion_date: new Date().toISOString(),
    reviewed_by: adminId,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  })
  .eq('id', taskId);

// ❌ BAD - Only updating status
await supabase
  .from('developer_tasks')
  .update({ status: 'completed' })
  .eq('id', taskId);
```

### 2. **Validate Status Transitions**
Prevent invalid state changes:
```javascript
const VALID_TRANSITIONS = {
  'pending': ['in_progress', 'rejected'],
  'in_progress': ['awaiting_approval', 'pending'],
  'awaiting_approval': ['reviewed', 'completed', 'rejected', 'in_progress'],
  'reviewed': ['completed', 'rejected', 'awaiting_approval'],
  'completed': [], // Final state
  'rejected': ['pending', 'in_progress']
};

function canTransition(currentStatus, newStatus) {
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

// Use in your API:
if (!canTransition(task.status, newStatus)) {
  return res.status(400).json({
    error: `Cannot transition from ${task.status} to ${newStatus}`
  });
}
```

### 3. **Create Activity Logs for Status Changes**
Track all status changes for audit trail:
```javascript
await supabase.from('activity_logs').insert({
  developer_id: task.developer_id,
  project_id: task.project_id,
  activity_type: 'status_change',
  description: `Task "${task.task_title}" status changed from ${oldStatus} to ${newStatus}`,
  metadata: {
    task_id: taskId,
    old_status: oldStatus,
    new_status: newStatus,
    changed_by: userId
  }
});
```

### 4. **Use Database Triggers for Consistency**
Let the database handle automatic updates:
```sql
-- Example: Automatically set submitted_at when status changes to awaiting_approval
CREATE OR REPLACE FUNCTION set_submitted_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'awaiting_approval' AND OLD.status != 'awaiting_approval' THEN
    NEW.submitted_at = NOW();
  END IF;

  -- Always update updated_at
  NEW.updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_status_update
  BEFORE UPDATE ON developer_tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_submitted_at();
```

### 5. **Handle Edge Cases**

#### What if a rejected task needs to be fixed?
```javascript
// Option 1: Send back to in_progress
status = 'in_progress'  // Developer fixes issues

// Option 2: Reset to pending for reassignment
status = 'pending'  // Reassign to another developer
```

#### What if a completed task has issues?
```javascript
// ❌ Don't change completed tasks
// ✅ Create a new task for the fix/update
// Completed tasks should remain immutable for reporting accuracy
```

### 6. **Use Enum Constants (TypeScript)**
Define status values once:
```typescript
// constants/taskStatus.ts
export const TaskStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  AWAITING_APPROVAL: 'awaiting_approval',
  REVIEWED: 'reviewed',
  COMPLETED: 'completed',
  REJECTED: 'rejected'
} as const;

export type TaskStatusType = typeof TaskStatus[keyof typeof TaskStatus];

// Usage:
status: TaskStatus.COMPLETED  // Type-safe!
```

### 7. **Frontend Status Display**
```javascript
const STATUS_CONFIG = {
  pending: {
    color: 'gray',
    icon: '⏸️',
    label: 'Not Started'
  },
  in_progress: {
    color: 'blue',
    icon: '⚡',
    label: 'In Progress'
  },
  awaiting_approval: {
    color: 'yellow',
    icon: '⏳',
    label: 'Awaiting Review'
  },
  reviewed: {
    color: 'purple',
    icon: '👀',
    label: 'Reviewed'
  },
  completed: {
    color: 'green',
    icon: '✅',
    label: 'Completed'
  },
  rejected: {
    color: 'red',
    icon: '❌',
    label: 'Rejected'
  }
};
```

### 8. **Query Optimization**
Index status column for faster queries:
```sql
CREATE INDEX idx_developer_tasks_status ON developer_tasks(status);
CREATE INDEX idx_developer_tasks_status_developer ON developer_tasks(status, developer_id);
CREATE INDEX idx_developer_tasks_status_project ON developer_tasks(status, project_id);
```

### 9. **Monitor Status Metrics**
Track task flow analytics:
```sql
-- Average time in each status
SELECT
  status,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 86400 as avg_days
FROM developer_tasks
GROUP BY status;

-- Bottleneck detection (tasks stuck in status)
SELECT
  id,
  task_title,
  status,
  EXTRACT(DAY FROM (NOW() - updated_at)) as days_in_status
FROM developer_tasks
WHERE status IN ('awaiting_approval', 'reviewed')
  AND EXTRACT(DAY FROM (NOW() - updated_at)) > 3;
```

### 10. **Send Real-time Notifications**
Notify relevant parties on status changes:
```javascript
const NOTIFICATION_RULES = {
  'awaiting_approval': ['admin'], // Notify admin
  'completed': ['developer'],     // Notify developer
  'rejected': ['developer'],      // Notify developer
  'reviewed': ['developer']       // Notify developer
};

async function sendStatusNotification(task, newStatus) {
  const recipients = NOTIFICATION_RULES[newStatus] || [];

  for (const recipient of recipients) {
    await createNotification({
      recipient,
      type: 'status_change',
      task_id: task.id,
      message: `Task "${task.task_title}" is now ${newStatus}`
    });
  }
}
```

## 🚫 Common Pitfalls to Avoid

1. **Don't skip status states**: Follow the workflow order
2. **Don't allow direct jumps**: `pending → completed` should go through intermediate states
3. **Don't modify completed tasks**: They're historical records
4. **Don't forget timestamps**: Always update `updated_at`, `submitted_at`, etc.
5. **Don't ignore concurrency**: Use optimistic locking if multiple users can update

## 🎯 Summary

- ✅ Use clear, consistent status values
- ✅ Validate transitions before updating
- ✅ Log all status changes
- ✅ Update related fields atomically
- ✅ Use database constraints to enforce rules
- ✅ Index status columns for performance
- ✅ Notify users on important status changes
- ✅ Keep completed/rejected tasks immutable
