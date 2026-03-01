-- ═══════════════════════════════════════════════════════════
-- Schedule + Inventory + Wheel Config Schema Updates
-- Run this in the Supabase SQL Editor before deploying
-- ═══════════════════════════════════════════════════════════

-- 1. Add thumbnail + is_special to scheduled_shows
ALTER TABLE scheduled_shows ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE scheduled_shows ADD COLUMN IF NOT EXISTS is_special BOOLEAN NOT NULL DEFAULT false;

-- 2. Add quantity tracking to admin_inventory
ALTER TABLE admin_inventory ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;
ALTER TABLE admin_inventory ADD COLUMN IF NOT EXISTS quantity_sold INT NOT NULL DEFAULT 0;

-- 3. Add status lifecycle to wheel_configs
ALTER TABLE wheel_configs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pre_game';

-- ═══════════════════════════════════════════════════════════
-- Seed: HoneyBunBean's 5 Scheduled Shows (3/1 – 3/3/2026)
-- PST times converted to UTC (PST = UTC-8)
-- ═══════════════════════════════════════════════════════════

INSERT INTO scheduled_shows (host_slug, show_type, title, description, scheduled_at, duration_minutes, status, whatnot_url, is_special, thumbnail_url, created_by)
VALUES
  -- Sun 3/1/26 6:00pm PST → 2026-03-02 02:00 UTC
  ('honeybunbean', 'pokemon', 'Bean''s $1 Pokeparty',
   '$1 Start Auctions for packs and individual cards + Giveaways',
   '2026-03-02T02:00:00Z', 60, 'scheduled',
   'https://www.whatnot.com/s/o8Oi5boF', false,
   'https://res.cloudinary.com/dqn1tnmhl/image/upload/v1772380387/BEAN_s_wwxfdv.png',
   (SELECT auth0_id FROM profiles WHERE role = 'admin' LIMIT 1)),

  -- Mon 3/2/26 6:00pm PST → 2026-03-03 02:00 UTC
  ('honeybunbean', 'pokemon', 'Bean''s $1 Pokeparty',
   '$1 Start Auctions for packs and individual cards + Giveaways',
   '2026-03-03T02:00:00Z', 60, 'scheduled',
   'https://www.whatnot.com/s/LvyIDBmC', false,
   'https://res.cloudinary.com/dqn1tnmhl/image/upload/v1772380387/BEAN_s_wwxfdv.png',
   (SELECT auth0_id FROM profiles WHERE role = 'admin' LIMIT 1)),

  -- Mon 3/2/26 7:00pm PST → 2026-03-03 03:00 UTC
  ('honeybunbean', 'pokemon', 'Charizard UPC Break',
   'Charizard UPC Break show',
   '2026-03-03T03:00:00Z', 60, 'scheduled',
   'https://www.whatnot.com/s/mlIDBzhN', true,
   'https://res.cloudinary.com/dqn1tnmhl/image/upload/v1772380387/ChatGPT_Image_Feb_28_2026_10_22_35_PM_wwsdot.png',
   (SELECT auth0_id FROM profiles WHERE role = 'admin' LIMIT 1)),

  -- Tue 3/3/26 6:00pm PST → 2026-03-04 02:00 UTC
  ('honeybunbean', 'pokemon', 'Bean''s $1 Pokeparty',
   '$1 Start Auctions for packs and individual cards + Giveaways',
   '2026-03-04T02:00:00Z', 60, 'scheduled',
   'https://www.whatnot.com/s/bjlCL7V6', false,
   'https://res.cloudinary.com/dqn1tnmhl/image/upload/v1772380387/BEAN_s_wwxfdv.png',
   (SELECT auth0_id FROM profiles WHERE role = 'admin' LIMIT 1)),

  -- Tue 3/3/26 7:00pm PST → 2026-03-04 03:00 UTC
  ('honeybunbean', 'pokemon', 'Ascended Heroes Break',
   'Ascended Heroes Break show',
   '2026-03-04T03:00:00Z', 60, 'scheduled',
   'https://www.whatnot.com/s/khOtUPa2', true,
   'https://res.cloudinary.com/dqn1tnmhl/image/upload/v1772380387/ChatGPT_Image_Feb_28_2026_10_56_40_PM_hupi7p.png',
   (SELECT auth0_id FROM profiles WHERE role = 'admin' LIMIT 1));
