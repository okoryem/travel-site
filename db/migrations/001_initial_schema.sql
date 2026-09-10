-- Core content model. Mirrors docs/CONTENT-MODEL.md, normalised.
--
-- The shape that matters: a clip belongs to a location, a location belongs to a
-- trip, and a trip belongs to a country. That chain is what makes "countries
-- ordered by first visit" or "clips per trip" a single query rather than
-- application-side bookkeeping.

CREATE TABLE countries (
  code        CHAR(2) PRIMARY KEY,          -- ISO 3166-1 alpha-2
  name        TEXT NOT NULL,
  -- Matches the map's travel tiers (src/lib/countries.ts).
  tier        TEXT CHECK (tier IN ('birth', 'before', 'after')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A trip is a single journey. This is where real dates live: `shotOn` on each
-- clip is currently an export-date placeholder, and a trip's date range is the
-- honest source for when footage was actually taken.
CREATE TABLE trips (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  country_code  CHAR(2) NOT NULL REFERENCES countries(code) ON UPDATE CASCADE,
  started_on    DATE,
  ended_on      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A trip cannot end before it starts. Cheap to enforce here, easy to get
  -- wrong everywhere else.
  CONSTRAINT trips_dates_ordered CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);

CREATE TABLE locations (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,               -- as displayed: "Huacachina, Peru"
  country_code  CHAR(2) NOT NULL REFERENCES countries(code) ON UPDATE CASCADE,
  trip_id       INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  lat           DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon           DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clips (
  -- Text id, not serial: this is the public URL and must stay stable (ADR-005).
  id             TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title          TEXT NOT NULL,
  location_id    INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  shot_on        DATE NOT NULL,
  published_at   DATE NOT NULL,
  duration_sec   NUMERIC(8,2) NOT NULL CHECK (duration_sec > 0),
  aspect_ratio   TEXT NOT NULL,
  featured       BOOLEAN NOT NULL DEFAULT FALSE,
  story          TEXT,

  -- Delivery file. Paths stay relative so no domain is baked into content.
  mp4_url        TEXT NOT NULL CHECK (mp4_url LIKE '/media/%'),
  mp4_width      INTEGER NOT NULL CHECK (mp4_width > 0),
  mp4_height     INTEGER NOT NULL CHECK (mp4_height > 0),
  mp4_bitrate_kbps INTEGER NOT NULL CHECK (mp4_bitrate_kbps > 0),

  poster_url     TEXT NOT NULL CHECK (poster_url LIKE '/media/%'),
  poster_width   INTEGER NOT NULL CHECK (poster_width > 0),
  poster_height  INTEGER NOT NULL CHECK (poster_height > 0),

  -- Where the master lives, relative to the media root. Phase 2 render jobs
  -- need this; the site never serves it.
  master_rel_path TEXT,
  master_codec    TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-to-one with clips. Separate table rather than more columns: narration is
-- optional, independently replaceable, and the transcript will eventually grow
-- timed cues.
CREATE TABLE narrations (
  clip_id       TEXT PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
  url           TEXT NOT NULL CHECK (url LIKE '/media/%'),
  duration_sec  NUMERIC(8,2) NOT NULL CHECK (duration_sec > 0),
  transcript    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id     SERIAL PRIMARY KEY,
  slug   TEXT NOT NULL UNIQUE,
  label  TEXT NOT NULL
);

-- Many-to-many. Composite primary key prevents duplicate pairs without a
-- separate unique index.
CREATE TABLE clip_tags (
  clip_id  TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (clip_id, tag_id)
);

-- Indexes for the queries the site actually runs. Foreign keys are not indexed
-- automatically in Postgres, and every one of these backs a real access path:
-- rows grouped by country, clips on a map, chronological ordering.
CREATE INDEX clips_location_idx    ON clips(location_id);
CREATE INDEX clips_shot_on_idx     ON clips(shot_on DESC);
CREATE INDEX clips_featured_idx    ON clips(featured) WHERE featured;
CREATE INDEX locations_country_idx ON locations(country_code);
CREATE INDEX locations_trip_idx    ON locations(trip_id);
CREATE INDEX trips_country_idx     ON trips(country_code);
CREATE INDEX clip_tags_tag_idx     ON clip_tags(tag_id);

-- Keep updated_at honest without relying on every writer to remember.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clips_touch_updated_at
  BEFORE UPDATE ON clips
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
