/**
 * Where a task IS — two different questions, told apart.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Three modules each had their own idea of what "open" means, and each was
 * RIGHT for its own question — but all three used the same word, so together
 * they read as a contradiction:
 *
 *   utils/bugs.isOpenBug              `reviewed` is OPEN
 *   utils/orgWorkGraph.isOpenTask     `reviewed` is CLOSED
 *   /api/projects/[id]/closure gate   `reviewed` is OPEN
 *
 * A project manager looking at two screens saw Capacity report a developer as
 * "Free" while the Bug queue showed three of their bugs still open. Both were
 * true. Neither said which question it was answering.
 *
 * THE TWO QUESTIONS
 *
 *   isSettled(task)          Is this finished, for good?
 *                            Only `completed`. Used by the bug queue and by the
 *                            project-closure gate, because "can we close this
 *                            project?" must not be satisfied by work that is
 *                            merely out of somebody's inbox.
 *
 *   isOnSomeonesPlate(task)  Is the ASSIGNEE still holding it?
 *                            `completed` and `reviewed` are not. Used by
 *                            Capacity, because a task sitting with QA is not
 *                            work the developer can be given less of.
 *
 * They differ on exactly one status, `reviewed`, and that difference is the
 * whole point: it means "the developer is done, QA has it". Settled? No.
 * On their plate? Also no.
 *
 * `rejected` is unsettled AND on their plate under both — work sent back is
 * back with the person who did it. That is what makes a separate "rework"
 * status unnecessary: the pipeline already expresses it, and a second name for
 * a state the product already has is how two screens start disagreeing about
 * the same row.
 */

/** Finished for good. Nothing else counts, deliberately. */
export const SETTLED_STATUSES = new Set(["completed"]);

/**
 * Statuses that mean the assignee has handed it on.
 *
 * `reviewed` is here and NOT in SETTLED_STATUSES — see the note above.
 */
export const OFF_PLATE_STATUSES = new Set(["completed", "reviewed"]);

export const isSettled = (task) => SETTLED_STATUSES.has(task?.status);

/** The negation, named — `!isSettled(t)` at a call site reads as "not done". */
export const isUnsettled = (task) => !isSettled(task);

export const isOnSomeonesPlate = (task) => !OFF_PLATE_STATUSES.has(task?.status);

/**
 * The same rule as a PostgREST filter value, so a server-side query and a
 * client-side predicate cannot drift.
 *
 *   query.not("status", "in", settledFilter())
 *
 * Built from the set rather than typed out: adding a settled status in one
 * place would otherwise leave every SQL filter still asking the old question.
 */
export const settledFilter = () => `(${[...SETTLED_STATUSES].join(",")})`;
