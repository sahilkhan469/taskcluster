import assert from 'assert';
import helper from '../helper.js';
import testing from '@taskcluster/lib-testing';
import taskcluster from '@taskcluster/client';

const THIS_VERSION = parseInt(/.*\/0*(\d+)_test\.js/.exec(import.meta.url)[1]);
const PREV_VERSION = THIS_VERSION - 1;

suite(testing.suiteName(), function() {
  helper.withDbForVersion();

  test('schedule_task atomically inserts into queue_pending_tasks after upgrade', async function() {
    await testing.resetDb({ testDbUrl: helper.dbUrl });
    await helper.upgradeTo(THIS_VERSION);

    const db = await helper.setupDb('queue');
    const taskId = 'abcDEFghiJKLmnoPQRstuv';
    const created = taskcluster.fromNow('0 hours');
    const deadline = taskcluster.fromNow('1 hour');
    const expires = taskcluster.fromNow('2 hours');

    await db.fns.create_task_projid(
      taskId, 'prov/wt', 'sched', 'proj', 'group-1',
      JSON.stringify([]), 'all-completed', JSON.stringify([]),
      'high', 5, created, deadline, expires,
      JSON.stringify([]), {}, {}, JSON.stringify([]), {},
    );

    await db.fns.schedule_task(taskId, 'scheduled');

    const rows = await helper.withDbClient(async client => {
      const { rows } = await client.query(
        'select task_queue_id, priority, run_id from queue_pending_tasks where task_id = $1',
        [taskId],
      );
      return rows;
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].task_queue_id, 'prov/wt');
    assert.equal(rows[0].priority, 5);
    assert.equal(rows[0].run_id, 0);
  });

  test('downgrade removes queue_pending_tasks_add_for_task and reverts schedule_task', async function() {
    await testing.resetDb({ testDbUrl: helper.dbUrl });
    await helper.upgradeTo(THIS_VERSION);
    await helper.downgradeTo(PREV_VERSION);

    // After downgrade the helper function should no longer exist in the DB
    const exists = await helper.withDbClient(async client => {
      const { rows } = await client.query(`
        select count(*)::int as count
        from pg_proc
        where proname = 'queue_pending_tasks_add_for_task'
      `);
      return rows[0].count > 0;
    });
    assert.equal(exists, false, 'queue_pending_tasks_add_for_task should not exist after downgrade');

    // The four modified DB fns must revert to their pre-123 bodies, which
    // do NOT enqueue into queue_pending_tasks. Exercise schedule_task as a
    // representative: after downgrade it should update tasks.runs but leave
    // queue_pending_tasks empty.
    const db = await helper.setupDb('queue');
    const taskId = 'abcDEFghiJKLmnoPQRstuv';
    const created = taskcluster.fromNow('0 hours');
    const deadline = taskcluster.fromNow('1 hour');
    const expires = taskcluster.fromNow('2 hours');

    await db.fns.create_task_projid(
      taskId, 'prov/wt', 'sched', 'proj', 'group-1',
      JSON.stringify([]), 'all-completed', JSON.stringify([]),
      'high', 5, created, deadline, expires,
      JSON.stringify([]), {}, {}, JSON.stringify([]), {},
    );

    await db.fns.schedule_task(taskId, 'scheduled');

    const pendingRows = await helper.withDbClient(async client => {
      const { rows } = await client.query(
        'select count(*)::int as c from queue_pending_tasks where task_id = $1',
        [taskId],
      );
      return rows[0].c;
    });
    assert.equal(pendingRows, 0, 'post-downgrade schedule_task must not enqueue into queue_pending_tasks');
  });
});
