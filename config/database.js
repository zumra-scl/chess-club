import sqlite3 from "sqlite3";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";

const sqlite = sqlite3.verbose();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const createKayttajatSql = `CREATE TABLE IF NOT EXISTS kayttajat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tunnus TEXT NOT NULL UNIQUE,
    salasana TEXT NOT NULL,
    sahkoposti TEXT NOT NULL,
    yllapitaja INTEGER NOT NULL
)`;

const createTapahtumatSql = `CREATE TABLE IF NOT EXISTS tapahtumat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aikaleima DATETIME NOT NULL,
    kuvaus TEXT NOT NULL
)`;

const createViestitSql = `CREATE TABLE IF NOT EXISTS viestit (
    nimi TEXT NOT NULL,
    viesti TEXT NOT NULL
)`;

const kayttajat = [
  ["hakkeri", "hack123", "hakkeri@hacknet.com.invalid", 0],
  ["timo", "timo345", "timo@sposti.fi.invalid", 0],
  ["admin", "adminqwerty", "admin@sposti.fi.invalid", 1],
  ["sara", "sara123", "sara@sposti.fi.invalid", 0],
];
const insertTapahtumatSql = `INSERT INTO tapahtumat (aikaleima, kuvaus) VALUES 
    ('2026-08-08', 'Käyttäjä timo kirjautui sisään.'),
    ('2026-08-09', 'Käyttäjä admin kirjautui sisään.')`;

const insertViestitSql = `INSERT INTO viestit (nimi, viesti) VALUES
    ('timo', 'Tervetuloa kerhon viestitaululle!'),
    ('sara', 'Milloin seuraava turnaus on?')`;

export function connectDB() {
  const dbPath = path.join(__dirname, "..", "database", "injection.db");
  const db = new sqlite.Database(dbPath, (err) => {
    if (err) {
      console.error("Yhteyden muodostaminen epäonnistui: " + err.message);
      return;
    }
    console.log("Tietokantayhteys muodostettu.");
  });

  return db;
}

function createTables(db) {
  db.run(createKayttajatSql);
  db.run(createTapahtumatSql);
  db.run(createViestitSql);
}

function insertDefaults(db, callback) {
  db.run(insertKayttajatSql);
  db.run(insertTapahtumatSql);
  db.run(insertViestitSql, callback);
}

export function initializeDB() {
  const db = connectDB();

  db.serialize(() => {
    createTables(db);

    db.get("SELECT COUNT(*) AS lkm FROM kayttajat", async (err, row) => {
      if (err || !row || row.lkm > 0) {
        return;
      }

      for (const [tunnus, salasana, sahkoposti, yllapitaja] of kayttajat) {
        const hash = await bcrypt.hash(salasana, 10);

        db.run(
          "INSERT INTO kayttajat (tunnus, salasana, sahkoposti, yllapitaja) VALUES (?, ?, ?, ?)",
          [tunnus, hash, sahkoposti, yllapitaja],
        );
      }
    });

    db.get("SELECT COUNT(*) AS lkm FROM tapahtumat", (err, row) => {
      if (err || !row || row.lkm > 0) {
        return;
      }

      db.run(insertTapahtumatSql);
    });

    db.get("SELECT COUNT(*) AS lkm FROM viestit", (err, row) => {
      if (err || !row || row.lkm > 0) {
        return;
      }

      db.run(insertViestitSql);
    });
  });

  return db;
}

export function resetDB() {
  return new Promise((resolve, reject) => {
    const db = connectDB();

    db.serialize(() => {
      db.run("DROP TABLE IF EXISTS kayttajat");
      db.run("DROP TABLE IF EXISTS tapahtumat");
      db.run("DROP TABLE IF EXISTS viestit");
      createTables(db);
      insertDefaults(db, (err) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        db.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
          } else {
            resolve();
          }
        });
      });
    });
  });
}
