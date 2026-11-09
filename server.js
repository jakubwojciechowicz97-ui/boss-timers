// Własny serwer Boss Timers - czysty Node.js, bez zależności.
// Protokół jest taki sam jak w Workerze (boss_worker.js), więc ten sam skrypt w grze działa z obiema wersjami.
//
//   GET  /        -> {"Holy Cultist": {"alive": false, "respawnTime": 1730000000, "updated": 1729990000}, ...}
//   POST /report  -> body JSON: {"token": "...", "name": "Holy Cultist", "alive": false, "respawnTime": 1730000000}
//
// Zmienne środowiskowe:
//   REPORT_TOKEN  (wymagana) - tajny klucz, ten sam co w skrypcie w grze
//   PORT          (opcjonalna, hosting ustawia sam)
//   DATA_FILE     (opcjonalna) - gdzie zapisywać stan, domyślnie ./data.json

const http = require("http");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.REPORT_TOKEN || "";
const DATA_FILE = process.env.DATA_FILE || "./data.json";

if (!TOKEN) {
  console.error("Brak REPORT_TOKEN - ustaw zmienną środowiskową, inaczej zgłoszenia będą odrzucane.");
}

let state = {};
try {
  state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (e) {
  state = {};
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(state), (err) => {
      if (err) console.error("Nie udało się zapisać stanu:", err.message);
    });
  }, 1000);
}

function send(res, code, body, type) {
  res.writeHead(code, { "content-type": type || "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, JSON.stringify(state), "application/json");
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, "ok");
  }

  if (req.method === "POST" && url.pathname === "/report") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 4096) req.destroy();
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch (e) {
        return send(res, 400, "bad json");
      }

      if (!TOKEN || body.token !== TOKEN) return send(res, 403, "forbidden");

      const name = String(body.name || "").trim();
      if (!name || name.length > 40) return send(res, 400, "bad name");

      const alive = body.alive === true;
      const rt = Math.floor(Number(body.respawnTime) || 0);
      const now = Math.floor(Date.now() / 1000);

      // martwy boss musi mieć sensowny czas respawnu (od chwili temu do 2 dób w przód)
      if (!alive && !(rt > now - 60 && rt < now + 2 * 86400)) return send(res, 400, "bad respawnTime");

      const prev = state[name];
      // to samo zdarzenie zgłoszone kilka razy - pierwsze wygrywa
      if (prev && prev.alive === alive && now - (prev.updated || 0) < 120) {
        return send(res, 200, "duplicate ignored");
      }

      state[name] = { alive, respawnTime: alive ? null : rt, updated: now };
      save();
      return send(res, 200, "ok");
    });
    return;
  }

  send(res, 404, "not found");
});

server.listen(PORT, () => console.log("Boss Timers server na porcie " + PORT));
