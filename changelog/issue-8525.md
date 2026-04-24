audience: general
level: patch
reference: issue 8525
---
Fix a race where a Taskcluster task could end up stuck in the `pending` state but invisible to workers and to the "pending tasks" UI/API counts when a Pulse publish failed during a run state transition. Transitions of a run to `pending` now commit the `queue_pending_tasks` row in the same database transaction as the `tasks.runs` update.
