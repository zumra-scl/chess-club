import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import expressLayouts from "express-ejs-layouts";
import path from "path";
import { fileURLToPath } from "url";
import { initializeDB, connectDB } from "./config/database.js";
import { fi } from "./locales/fi.js";
import { en } from "./locales/en.js";

const translations = { fi, en };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

initializeDB();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET ympäristömuuttuja puuttuu");
}

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use((req, res, next) => {
  const match = req.path.match(/^\/(en|fi)(?=\/|$)/);
  if (match) {
    req.lang = match[1];
    req.langPrefix = `/${match[1]}`;
    const stripped = req.url.slice(match[0].length);
    req.url =
      stripped === "" || stripped.startsWith("?") ? `/${stripped}` : stripped;
  } else {
    req.lang = "fi";
    req.langPrefix = "";
  }

  res.locals.lang = req.lang;
  res.locals.langPrefix = req.langPrefix;
  res.locals.t = translations[req.lang];
  res.locals.p = (pathname) => `${req.langPrefix}${pathname}`;
  res.locals.user = req.session.user || null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect(res.locals.p("/"));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.yllapitaja != 1) {
    return res.redirect(res.locals.p("/"));
  }
  next();
}

function haeViestit(callback) {
  const db = connectDB();
  db.all("SELECT * FROM viestit", [], (err, results) => {
    db.close();
    callback(err, results || []);
  });
}

app.get("/", (req, res) => {
  res.render("home", { user: null, error: null, attemptedName: "" });
});

app.post("/login", (req, res) => {
  const db = connectDB();
  const tunnus = req.body.tunnus || "";
  const salasana = req.body.salasana || "";

  if (!tunnus) {
    db.close();
    return res.render("home", { user: null, error: null, attemptedName: "" });
  }

  const hakusql = "SELECT * FROM kayttajat WHERE tunnus = ? AND salasana = ?";
  db.all(hakusql, [tunnus, salasana], (err, results) => {
    if (err) {
      console.error("Virhe kirjautumisessa:", err);
      db.close();
      return res.render("home", {
        user: null,
        error: res.locals.t.home.loginError,
        attemptedName: tunnus,
      });
    }

    if (results && results.length > 0) {
      req.session.regenerate((err) => {
        if (err) {
          console.error("Virhe istunnon uusimisessa:", err);
          db.close();
          return res.render("home", {
            user: null,
            error: res.locals.t.home.loginError,
            attemptedName: tunnus,
          });
        }

        req.session.user = {
          id: results[0].id,
          tunnus: results[0].tunnus,
          yllapitaja: results[0].yllapitaja,
        };

        const tapahtumasql =
          "INSERT INTO tapahtumat (aikaleima, kuvaus) VALUES (datetime('now'), ?)";
        const kuvaus = `Käyttäjä ${results[0].tunnus} kirjautui sisään.`;

        db.run(tapahtumasql, [kuvaus], () => {
          db.close();
          res.redirect(res.locals.p("/viestit"));
        });
      });
    } else {
      db.close();
      res.render("home", {
        user: null,
        error: null,
        attemptedName: tunnus,
      });
    }
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Virhe uloskirjautumisessa:", err);
      return res.redirect(res.locals.p("/"));
    }

    res.clearCookie("connect.sid");
    res.redirect(res.locals.p("/"));
  });
});

app.get("/viestit", requireLogin, (req, res) => {
  haeViestit((err, viestit) => {
    if (err) {
      console.error("Virhe haettaessa viestejä:", err);
      return res.render("viestit", {
        viestit: [],
        error: res.locals.t.messages.fetchError,
      });
    }
    res.render("viestit", { viestit, error: null });
  });
});

app.post("/viestit", requireLogin, (req, res) => {
  const nimi = req.session.user.tunnus;
  const viesti = req.body.viesti || "";

  if (!viesti) {
    return haeViestit((err, viestit) => {
      if (err) {
        console.error("Virhe haettaessa viestejä:", err);
        return res.render("viestit", {
          viestit: [],
          error: res.locals.t.messages.fetchError,
        });
      }

      res.render("viestit", {
        viestit: viestit || [],
        error: res.locals.t.messages.empty,
      });
    });
  }

  const db = connectDB();
  const sql = "INSERT INTO viestit (nimi, viesti) VALUES (?, ?)";
  db.run(sql, [nimi, viesti], (err) => {
    db.close();
    if (err) {
      console.error("Virhe lisätessä viestiä:", err);
      return haeViestit((fetchErr, viestit) => {
        res.render("viestit", {
          viestit: viestit || [],
          error: res.locals.t.messages.insertError,
        });
      });
    }
    res.redirect(res.locals.p("/viestit"));
  });
});

app.get("/pelit", requireLogin, (req, res) => {
  res.render("pelit");
});

app.get("/kayttajat", requireAdmin, (req, res) => {
  const db = connectDB();
  db.all(
    "SELECT tunnus, sahkoposti, yllapitaja FROM kayttajat",
    [],
    (err, kayttajat) => {
      db.close();
      if (err) {
        console.error("Virhe haettaessa käyttäjiä:", err);
        return res.render("kayttajat", {
          kayttajat: [],
          error: res.locals.t.users.fetchError,
        });
      }
      res.render("kayttajat", { kayttajat: kayttajat || [], error: null });
    },
  );
});

app.get("/tapahtumat", requireAdmin, (req, res) => {
  const db = connectDB();
  db.all(
    "SELECT * FROM tapahtumat ORDER BY aikaleima DESC, id DESC",
    [],
    (err, tapahtumat) => {
      db.close();
      if (err) {
        console.error("Virhe haettaessa tapahtumia:", err);
        return res.render("tapahtumat", {
          tapahtumat: [],
          error: res.locals.t.events.fetchError,
        });
      }
      res.render("tapahtumat", { tapahtumat: tapahtumat || [], error: null });
    },
  );
});

app.use((req, res) => {
  res.status(404).render("404");
});

app.listen(PORT, () => {
  console.log(`Palvelin käynnistetty portissa ${PORT}`);
  console.log(`Avaa selain osoitteessa: http://localhost:${PORT}`);
});
