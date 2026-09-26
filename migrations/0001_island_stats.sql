-- 島ごとの回答数と正解数（島 ID は islands.json の id）
CREATE TABLE island_stats (
  id TEXT PRIMARY KEY,
  answers INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0
);
