CREATE TABLE IF NOT EXISTS years (
  owner TEXT NOT NULL,
  year INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner, year)
);
CREATE TABLE IF NOT EXISTS plantings (
  owner TEXT NOT NULL,
  year INTEGER NOT NULL,
  plant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  variety TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner, year, plant_id)
);
CREATE TABLE IF NOT EXISTS custom_plants (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  life TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner, id)
);
CREATE TABLE IF NOT EXISTS notes (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  tag TEXT NOT NULL,
  body TEXT NOT NULL,
  observed_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner, id)
);
CREATE TABLE IF NOT EXISTS checks (
  owner TEXT NOT NULL,
  year INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner, year, task_id)
);
CREATE INDEX IF NOT EXISTS years_owner_sync ON years(owner, synced_at);
CREATE INDEX IF NOT EXISTS plantings_owner_sync ON plantings(owner, synced_at);
CREATE INDEX IF NOT EXISTS custom_plants_owner_sync ON custom_plants(owner, synced_at);
CREATE INDEX IF NOT EXISTS notes_owner_sync ON notes(owner, synced_at);
CREATE INDEX IF NOT EXISTS checks_owner_sync ON checks(owner, synced_at);
