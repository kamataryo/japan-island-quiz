-- 1プレイ1行の得点（mode は難易度帯・地域の表示名）
CREATE TABLE plays (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL,
  score INTEGER NOT NULL,
  questions INTEGER NOT NULL,
  played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
