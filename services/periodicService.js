/**
 * Periodic test scheduling — interval math and post-submit advancement for article_tests.
 */

function intervalDaysFromSchedule(schedule) {
  const t = String(schedule.frequency_type || '').toLowerCase();
  const v = Math.max(1, Number(schedule.frequency_value) || 1);
  switch (t) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'fortnightly':
      return 14;
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'custom':
      return Math.min(365, v);
    default:
      return v;
  }
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toISODateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * After a periodic article_test is submitted, complete the run and optionally create the next run.
 */
async function advanceAfterPeriodicSubmit(client, articleTestId, resultPassFail, preferredTesterId = null) {
  const ptrRes = await client.query(
    `SELECT * FROM periodic_test_runs WHERE article_test_id = $1 ORDER BY run_number DESC LIMIT 1`,
    [articleTestId]
  );
  if (ptrRes.rows.length === 0) return { advanced: false };

  const run = ptrRes.rows[0];
  if (run.status === 'submitted') return { advanced: false, alreadyDone: true };

  const psRes = await client.query(`SELECT * FROM periodic_schedules WHERE id = $1`, [run.schedule_id]);
  if (psRes.rows.length === 0) return { advanced: false };
  const schedule = psRes.rows[0];

  if (schedule.schedule_status !== 'active' || !schedule.is_active) {
    return { advanced: false, inactive: true };
  }

  const pass = String(resultPassFail || '').toUpperCase().includes('PASS');
  const resultVal = pass ? 'PASS' : 'FAIL';

  await client.query(
    `UPDATE periodic_test_runs SET
       status = 'submitted',
       result = $1,
       submitted_at = NOW(),
       updated_at = NOW()
     WHERE id = $2`,
    [resultVal, run.id]
  );

  const completed = Number(schedule.completed_occurrences || 0) + 1;
  const total = schedule.total_occurrences != null ? Number(schedule.total_occurrences) : null;

  if (total != null && completed >= total) {
    await client.query(
      `UPDATE periodic_schedules SET
         completed_occurrences = $1,
         is_active = false,
         schedule_status = 'ended',
         next_due_date = NULL,
         updated_at = NOW()
       WHERE id = $2`,
      [completed, schedule.id]
    );
    return { advanced: true, scheduleEnded: true };
  }

  const days = intervalDaysFromSchedule(schedule);
  const baseDue =
    toISODateOrNull(run.due_date) ||
    toISODateOrNull(schedule.next_due_date) ||
    toISODateOrNull(schedule.schedule_start_date) ||
    new Date().toISOString().slice(0, 10);
  const nextDue = addDays(baseDue, days);

  const srcRes = await client.query(`SELECT * FROM article_tests WHERE id = $1`, [articleTestId]);
  if (srcRes.rows.length === 0) {
    await client.query(
      `UPDATE periodic_schedules SET completed_occurrences = $1, updated_at = NOW() WHERE id = $2`,
      [completed, schedule.id]
    );
    return { advanced: true, error: 'source test missing' };
  }
  const t = srcRes.rows[0];
  const testerId =
    preferredTesterId != null
      ? Number(preferredTesterId)
      : (run.assigned_tester_id != null ? run.assigned_tester_id : t.assigned_tester_id);
  const nextStatus = testerId != null ? 'assigned' : 'pending';
  const nextAssignedAt = testerId != null ? new Date().toISOString() : null;

  const ins = await client.query(
    `INSERT INTO article_tests (
      article_id, batch_id, test_name, test_standard, client_requirement,
      category, execution_type, inhouse_test_id, vendor_name, vendor_contact,
      vendor_email, expected_report_date, assigned_tester_id, test_deadline,
      assigned_at, assigned_by, notes, status,
      is_periodic, periodic_schedule_id, periodic_run_number
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15,
      NULL,
      $16,
      $17,
      true, $18, $19
    ) RETURNING id`,
    [
      t.article_id,
      t.batch_id,
      t.test_name,
      t.test_standard,
      t.client_requirement,
      t.category,
      t.execution_type,
      t.inhouse_test_id,
      t.vendor_name,
      t.vendor_contact,
      t.vendor_email,
      t.expected_report_date,
      testerId,
      nextDue,
      nextAssignedAt,
      t.notes,
      nextStatus,
      schedule.id,
      run.run_number + 1
    ]
  );
  const newTestId = ins.rows[0].id;

  await client.query(
    `INSERT INTO periodic_test_runs (
      schedule_id, run_number, article_test_id, assigned_tester_id, due_date, status
    ) VALUES ($1, $2, $3, $4, $5, 'scheduled')`,
    [schedule.id, run.run_number + 1, newTestId, testerId, nextDue]
  );

  await client.query(
    `UPDATE periodic_schedules SET
       completed_occurrences = $1,
       next_due_date = $2,
       updated_at = NOW()
     WHERE id = $3`,
    [completed, nextDue, schedule.id]
  );

  return { advanced: true, nextArticleTestId: newTestId, nextDueDate: nextDue };
}

module.exports = {
  intervalDaysFromSchedule,
  addDays,
  toISODateOrNull,
  advanceAfterPeriodicSubmit
};
