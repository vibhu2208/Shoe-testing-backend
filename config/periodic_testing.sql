-- Periodic testing (article-based; Virola LIMS uses article_tests as the live assignment model)
-- Run after base schema: psql $DATABASE_URL -f config/periodic_testing.sql

CREATE TABLE IF NOT EXISTS periodic_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_article_test_id UUID NOT NULL REFERENCES article_tests(id) ON DELETE RESTRICT,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  test_name VARCHAR(255),
  test_standard VARCHAR(100),
  inhouse_test_id VARCHAR(50),
  client_requirement TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  schedule_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (schedule_status IN ('active', 'paused', 'ended')),
  frequency_type VARCHAR(20) NOT NULL
    CHECK (frequency_type IN ('daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'custom')),
  frequency_value INTEGER NOT NULL DEFAULT 1,
  total_occurrences INTEGER,
  completed_occurrences INTEGER NOT NULL DEFAULT 0,
  schedule_start_date DATE NOT NULL,
  next_due_date DATE,
  assigned_tester_id INTEGER REFERENCES users(id),
  alert_days_before INTEGER NOT NULL DEFAULT 3,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_periodic_schedules_next_due ON periodic_schedules(next_due_date)
  WHERE is_active = true AND schedule_status = 'active';
CREATE INDEX IF NOT EXISTS idx_periodic_schedules_client ON periodic_schedules(client_id);

CREATE TABLE IF NOT EXISTS periodic_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES periodic_schedules(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL,
  article_test_id UUID NOT NULL REFERENCES article_tests(id) ON DELETE CASCADE,
  assigned_tester_id INTEGER REFERENCES users(id),
  due_date DATE NOT NULL,
  alert_sent BOOLEAN NOT NULL DEFAULT false,
  alert_sent_at TIMESTAMP,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'alerted', 'in_progress', 'submitted', 'overdue', 'skipped')),
  result VARCHAR(10),
  submitted_at TIMESTAMP,
  report_url TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (schedule_id, run_number)
);

CREATE INDEX IF NOT EXISTS idx_periodic_runs_due ON periodic_test_runs(due_date);
CREATE INDEX IF NOT EXISTS idx_periodic_runs_article_test ON periodic_test_runs(article_test_id);

ALTER TABLE article_tests
  ADD COLUMN IF NOT EXISTS is_periodic BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS periodic_schedule_id UUID REFERENCES periodic_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS periodic_run_number INTEGER;

-- execution_type remains VARCHAR — application values include inhouse, outsource, both (no DB enum)
