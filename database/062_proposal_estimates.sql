-- =====================================================================
--  062 - the company's own numbers on a proposal
-- =====================================================================
--
--  WHAT IS WRONG TODAY, AND IT IS NOT "A FIELD IS MISSING"
--
--  `project_proposals` already carries `budget` and `desired_deadline`. Those
--  are the CLIENT'S figures — what they hoped to spend and when they hoped to
--  have it. There is nowhere for what the work would actually cost.
--
--  And those client figures are what the project is built from. In
--  /api/proposals/[id]/decide:
--
--      budget:   proposal.budget           <- the client's hope
--      deadline: proposal.desired_deadline <- the client's hope
--
--  So accepting a proposal today creates a project budgeted at whatever the
--  customer wished for. Every report, every margin figure and every "are we
--  over budget?" question downstream is then measured against a number nobody
--  in the company ever agreed to. It is not a missing field; it is the wrong
--  number being treated as a commitment.
--
--  These five columns are the company's answer, and the decide route uses them
--  in preference to the client's when they exist.
--
--  RUN PART 1, then PART 2 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The columns
-- ---------------------------------------------------------------------

alter table public.project_proposals
  --  What we would charge. Distinct from `budget`, which is what they asked
  --  for; keeping both is the point, because the gap between them is the
  --  conversation.
  add column if not exists estimated_cost numeric,

  --  Effort, for capacity planning. Separate from cost because a fixed-price
  --  quote and the work behind it are different facts, and collapsing them
  --  loses the one you need when the next quote comes in.
  add column if not exists estimated_hours numeric,

  --  How long, in days, rather than a date. A date on an unaccepted proposal
  --  is stale the moment the client takes a week to reply; a duration is still
  --  true whenever they answer.
  add column if not exists estimated_timeline_days integer,

  --  Staff only. Where "they will not like this price", "we lost money on the
  --  last one" and "only take this if Ali is free" get written down.
  --
  --  RLS CANNOT HIDE THIS COLUMN. Row Level Security is row-level: the client
  --  read policy from 059 correctly grants the whole row. Stripping it is the
  --  API route's job — see /api/proposals — exactly as with
  --  change_requests.pm_notes. Anyone reaching this table another way will see
  --  it, and that is worth knowing rather than assuming otherwise.
  add column if not exists internal_notes text,

  add column if not exists estimated_by uuid,
  add column if not exists estimated_at timestamptz;


-- ---------------------------------------------------------------------
--  PART 2 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  2a. Expect six rows, all nullable — a proposal exists before anyone has
--      costed it, so requiring these would refuse the client's submission.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'project_proposals'
  and column_name in ('estimated_cost','estimated_hours','estimated_timeline_days',
                      'internal_notes','estimated_by','estimated_at')
order by column_name;

--  2b. The client's own figures are untouched and still there.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'project_proposals'
  and column_name in ('budget','currency','desired_deadline')
order by column_name;

--  2c. No policy changed: the four from 059 and nothing else.
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'project_proposals'
order by policyname;
