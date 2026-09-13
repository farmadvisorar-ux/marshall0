-- Climate stress per county, for roof ageing.
--
-- An asphalt shingle fails from thermal cycling, not from the calendar. Denver
-- runs about 197 days a year that either freeze or exceed 90F; San Diego runs
-- one. A twenty-year-old roof is therefore not one thing, and roof age — the
-- heaviest signal in the roofing model — cannot be read the same way in both
-- places without saying something false about one of them.
--
-- Keyed by county rather than by parcel because that is the resolution the
-- underlying normals actually have: one weather station stands in for a wide
-- area, and pretending otherwise would be precision the source does not carry.
CREATE TABLE IF NOT EXISTS county_climate (
  fips              TEXT PRIMARY KEY REFERENCES counties(fips),
  freeze_days       NUMERIC,   -- annual mean days with a minimum at or below 32F
  hot_days          NUMERIC,   -- annual mean days with a maximum at or above 90F
  thermal_cycles    NUMERIC,   -- freeze_days + hot_days, the stress load
  station_id        TEXT,
  station_name      TEXT,
  station_km        NUMERIC,   -- how far the station is from the county centroid
  source            TEXT NOT NULL DEFAULT 'ncei-normals-1991-2020',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS county_climate_cycles_idx ON county_climate (thermal_cycles);
