-- ============================================================================
-- Migration 007 — Tenant-scoped code uniqueness
-- ============================================================================
-- Multi-tenant integrity audit finding (MEDIUM):
-- members/new_converts/events/prayers/small_groups all declared
-- `code text UNIQUE` — a GLOBAL unique constraint on a per-tenant attribute.
-- Two side effects:
--   * Cross-tenant collision: church B cannot reuse a code church A used
--     (availability bug on shared code schemes like M-001).
--   * Existence oracle: an attacker in tenant A can probe which codes exist
--     in tenant B by watching for unique-violation errors (weak info leak).
--
-- Codes are optional metadata (NULL allowed; nothing in the app looks rows up
-- by bare code), so scoping uniqueness to (church_id, code) — NULLs excluded
-- via partial index — fixes both without touching app code.
--
-- NOTE: if production already has non-NULL duplicate codes INSIDE one tenant,
-- index creation fails with the duplicates listed — clean those rows first.
-- Cross-tenant duplicates are now legal and do not block this migration.
-- ============================================================================

ALTER TABLE church.members       DROP CONSTRAINT IF EXISTS members_code_key;
ALTER TABLE church.new_converts  DROP CONSTRAINT IF EXISTS new_converts_code_key;
ALTER TABLE church.events        DROP CONSTRAINT IF EXISTS events_code_key;
ALTER TABLE church.prayers       DROP CONSTRAINT IF EXISTS prayers_code_key;
ALTER TABLE church.small_groups  DROP CONSTRAINT IF EXISTS small_groups_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS members_church_code_uniq
  ON church.members (church_id, code) WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS new_converts_church_code_uniq
  ON church.new_converts (church_id, code) WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS events_church_code_uniq
  ON church.events (church_id, code) WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prayers_church_code_uniq
  ON church.prayers (church_id, code) WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS small_groups_church_code_uniq
  ON church.small_groups (church_id, code) WHERE code IS NOT NULL;
