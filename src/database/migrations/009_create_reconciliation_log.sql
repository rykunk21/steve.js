-- Migration 009: Create reconciliation_log table for tracking reconciliation operations

CREATE TABLE IF NOT EXISTS reconciliation_log (
    id TEXT PRIMARY KEY,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    date_range_start DATE NOT NULL,
    date_range_end DATE NOT NULL,
    games_found INTEGER,
    games_processed INTEGER,
    games_failed INTEGER,
    data_sources TEXT,
    status TEXT CHECK (status IN ('running', 'completed', 'failed')) NOT NULL,
    error_message TEXT,
    triggered_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_log_status ON reconciliation_log(status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_started_at ON reconciliation_log(started_at);
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_date_range ON reconciliation_log(date_range_start, date_range_end);
