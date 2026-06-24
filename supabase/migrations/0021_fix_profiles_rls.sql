-- 0021: Fix RLS infinite recursion on profiles table.
--
-- profiles_admin_read was self-referential: it queried profiles FROM a policy ON profiles.
-- Any anon query that joined artists triggered artists_admin_read → which queried profiles →
-- which triggered profiles_admin_read → which queried profiles → infinite loop (pg error 42P17).
--
-- Fixes:
-- 1. Replace profiles_admin_read with a non-recursive own-profile read policy.
--    Admin CRUD uses the service-role key (bypasses RLS), so this is safe.
-- 2. Drop artists_admin_read — it queried profiles (triggering the loop for anon users),
--    and is redundant since artists_public_read already covers public SELECT and
--    admin ops use service-role.

DROP POLICY IF EXISTS profiles_admin_read ON profiles;
CREATE POLICY profiles_self_read ON profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS artists_admin_read ON artists;
