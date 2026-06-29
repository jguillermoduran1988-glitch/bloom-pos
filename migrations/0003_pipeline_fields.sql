ALTER TABLE wa_conversations ADD COLUMN pipeline_id TEXT;
ALTER TABLE wa_conversations ADD COLUMN stage TEXT DEFAULT 'nueva';
