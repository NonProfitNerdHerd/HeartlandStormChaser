-- Chase comment notes + additional expense categories

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS chase_notes (
  id TEXT PRIMARY KEY,
  chase_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chase_id) REFERENCES chases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chase_notes_chase_created ON chase_notes(chase_id, created_at DESC);

CREATE TABLE chase_expenses_new (
  id TEXT PRIMARY KEY,
  chase_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Gas', 'Food', 'Hotel', 'Other',
    'Equipment', 'Souveniers', 'Software Expense'
  )),
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expense_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chase_id) REFERENCES chases(id) ON DELETE CASCADE
);

INSERT INTO chase_expenses_new
SELECT * FROM chase_expenses;

DROP TABLE chase_expenses;

ALTER TABLE chase_expenses_new RENAME TO chase_expenses;

CREATE INDEX IF NOT EXISTS idx_chase_expenses_chase_id ON chase_expenses(chase_id);

PRAGMA foreign_keys = ON;
