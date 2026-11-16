-- Existing records keep NULL and the legacy Melodi delivery behavior.
-- Apply once to existing databases before deploying calendar ownership code.
ALTER TABLE melodi_calendar_events ADD COLUMN assigned_agent TEXT
  CHECK(assigned_agent IS NULL OR assigned_agent IN ('melodi'));
