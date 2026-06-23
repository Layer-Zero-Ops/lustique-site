-- 0016_blog_posts.sql
-- Blog posts managed from the admin dashboard.
-- Body is stored as plain text (double newlines = paragraph breaks).
-- Published posts are served publicly via GET /api/blog.

CREATE TABLE IF NOT EXISTS blog_posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  slug         text NOT NULL,
  excerpt      text,
  body         text NOT NULL DEFAULT '',
  cover_url    text,
  tags         text[] NOT NULL DEFAULT '{}',
  published    boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug_uniq ON blog_posts (lower(slug));

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Admin (service key) bypasses RLS; these policies cover anon/authenticated reads.
CREATE POLICY blog_posts_public_read ON blog_posts
  FOR SELECT USING (published = true);

CREATE POLICY blog_posts_admin_all ON blog_posts
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
