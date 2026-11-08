-- Permit the compatible v4 design envelope without rewriting existing rows.
SET ROLE hp_app_owner;
ALTER TABLE hp_app.designs DROP CONSTRAINT designs_schema_version_check;
ALTER TABLE hp_app.designs ADD CONSTRAINT designs_schema_version_check CHECK (schema_version IN (3, 4));
-- Enforce the independent wall envelope at the storage boundary as well as
-- the complete geometry and JSON schemas at the application boundary.
CREATE FUNCTION hp_private.shelf_payload_v4(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE w jsonb; pos jsonb;
BEGIN
  IF jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF p->'version' = '1'::jsonb THEN RETURN true; END IF; -- legacy shelf geometry
  IF p->'version' IS DISTINCT FROM '2'::jsonb OR
     NOT (p ?& ARRAY['version','shelf','wall','placement','activeTab']) OR
     p - ARRAY['version','shelf','wall','placement','activeTab'] <> '{}'::jsonb OR
     jsonb_typeof(p->'shelf') <> 'object' OR p->'shelf'->'version' IS DISTINCT FROM '1'::jsonb OR
     jsonb_typeof(p->'activeTab') <> 'string' OR p->>'activeTab' NOT IN ('custom','saetter') THEN RETURN false; END IF;
  w := p->'wall'; pos := p->'placement';
  IF jsonb_typeof(w) <> 'object' OR NOT (w ?& ARRAY['widthCm','heightCm','color']) OR
     w - ARRAY['widthCm','heightCm','color'] <> '{}'::jsonb OR
     jsonb_typeof(w->'widthCm') <> 'number' OR jsonb_typeof(w->'heightCm') <> 'number' OR
     jsonb_typeof(w->'color') <> 'string' OR w->>'color' !~ '^#[0-9a-fA-F]{6}$' OR
     (w->>'widthCm')::numeric NOT BETWEEN 10 AND 2000 OR (w->>'heightCm')::numeric NOT BETWEEN 10 AND 2000 THEN RETURN false; END IF;
  IF jsonb_typeof(pos) <> 'object' OR NOT (pos ?& ARRAY['offsetCm','elevationCm','gapCm']) OR
     pos - ARRAY['offsetCm','elevationCm','gapCm'] <> '{}'::jsonb OR
     jsonb_typeof(pos->'offsetCm') <> 'number' OR jsonb_typeof(pos->'elevationCm') <> 'number' OR jsonb_typeof(pos->'gapCm') <> 'number' OR
     (pos->>'offsetCm')::numeric NOT BETWEEN 0 AND 2000 OR (pos->>'elevationCm')::numeric NOT BETWEEN 0 AND 2000 OR (pos->>'gapCm')::numeric NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION hp_private.shelf_payload_v4(jsonb) TO hp_app_runtime;
ALTER TABLE hp_app.designs ADD CONSTRAINT designs_shelf_v4_envelope_check
  CHECK (schema_version <> 4 OR kind <> 'shelf' OR hp_private.shelf_payload_v4(payload));
-- Reject legacy replacement atomically, including callers with a current revision.
CREATE FUNCTION hp_private.guard_design_document_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.schema_version < OLD.schema_version OR
     (OLD.kind = 'shelf' AND OLD.payload->'version' = '2'::jsonb AND
      (NEW.kind IS DISTINCT FROM 'shelf' OR NEW.payload->'version' IS DISTINCT FROM '2'::jsonb)) THEN
    RAISE EXCEPTION 'HP_CONFLICT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER design_document_version_monotonic
BEFORE UPDATE ON hp_app.designs
FOR EACH ROW EXECUTE FUNCTION hp_private.guard_design_document_version();
RESET ROLE;
