-- Migration: richer exception (flag) actions — defer / reject / reopen
-- (UC-008 — Chad)
--
-- Extends the flags table so exceptions can be:
--   • deferred   — snoozed until `deferred_until`
--   • rejected   — closed as "not a real problem" (requires a reason)
-- alongside the existing resolve / dismiss / auto_resolve. Adds a dedicated
-- `resolution_note` column so the free-text reason for any action is stored
-- as data rather than folded into the message. A reopen returns a flag to
-- 'active' and clears these columns.
--
-- Safe to re-run (idempotent).

ALTER TABLE flags
    ADD COLUMN IF NOT EXISTS deferred_until  DATE,
    ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- Widen the status CHECK to include the two new terminal/holding states.
ALTER TABLE flags DROP CONSTRAINT IF EXISTS flags_status_check;
ALTER TABLE flags
    ADD CONSTRAINT flags_status_check
    CHECK (status IN ('active', 'resolved', 'dismissed', 'auto_resolved',
                      'deferred', 'rejected'));
