/* Cub Fuel Log - stable build */

const DB_NAME = "CubFuelDB";
const DB_VERSION = 1;
const STORE_NAME = "logs";

let db = null;
let allLogs = [];
let editingId = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  // 初期値
  $("date").valueAsDate = new Date();
  $("summaryMonth").value = new Date().toISOString().slice(0, 7);

  // タブ（inline onclick をやめて確実化）
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // 入力のたびにプレビュー更新
  ["date", "odometer", "fuel"].forEach((id) => {
    $(id).addEventListener("input", updatePreview);
  });

  // フォーム送信
  $("fuelForm").addEventListener("submit", handleSubmit);

  // CSV/操作ボタン
  $("toggleImport").addEventListener("click", () => {
    $("import-panel").classList.toggle("hidden");
  });
  $("importBtn").addEventListener("click", importCSV);
  $("exportBtn").addEventListener("click", exportCSV);
  $("deleteAllBtn").addEventListener("click", deleteAllLogs);
  $("summaryMonth").addEventListener("change", renderSummary);

  // IndexedDB
  initDB();

  // Service Worker（GitHub Pages は https なのでOK）
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./cub-sw.js").catch(console.error);
  }
});

function initDB() {
  const req = indexedDB.open(DB_NAME, DB_VERSION);

  req.onupgradeneeded = (e) => {
    const d = e.target.result;
    if (!d.objectStoreNames.contains(STORE_NAME)) {
      const store = d.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      store.createIndex("date", "date");
    }
  };

  req.onsuccess = (e) => {
    db = e.target.result;
    loadLogs();
  };

  req.onerror = () => showToast("データベースが開けません。");
}

function handleSubmit(e) {
  e.preventDefault();

  const data = {
    date: $("date").value,
    odometer: parseFloat($("odometer").value),
    fuel: parseFloat($("fuel").value) || 0,
    memo: $("memo").value || "",
    timestamp: Date.now(),
  };

  if (!data.date || Number.isNaN(data.odometer)) {
    showToast("日付と積算距離は必須です。");
    return;
  }

  if (editingId !== null) updateLog(editingId, data);
  else addLog(data);
}

function addLog(data) {
  if (!db) return;
  const tx = db.transaction([STORE_NAME], "readwrite");
  tx.objectStore(STORE_NAME).add(data);

  tx.oncomplete = () => {
    resetForm();
    loadLogs();
    showToast("記録を追加しました。");
  };
  tx.onerror = () => showToast("記録に失敗しました。");
}

function updateLog(id, data) {
  if (!db) return;

  const tx = db.transaction([STORE_NAME], "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const req = store.get(id);

  req.onsuccess = () => {
    const old = req.result;
    if (!old) {
      store.add(data);
      return;
    }
    store.put({ ...old, ...data, id });
  };

  tx.oncomplete = () => {
    resetForm();
    loadLogs();
    showToast("記録を更新しました。");
  };
  tx.onerror = () => showToast("更新に失敗しました。");
}

function resetForm() {
  editingId = null;
  $("fuelForm").reset();
  $("date").valueAsDate = new Date();
  $("submitButton").textContent = "💾 記録を追加する";
  $("fuel-preview-card").classList.remove("visible");
}

function loadLogs() {
  if (!db) return;

  const tx = db.transaction([STORE_NAME], "readonly");
  tx.objectStore(STORE_NAME).getAll().onsuccess = (e) => {
    const raw = e.target.result || [];

    raw.sort((a, b) => {
      if (a.date === b.date) return (a.odometer || 0) - (b.odometer || 0);
      return a.date < b.date ? -1 : 1;
    });

    let prev = null;
    allLogs = raw.map((log, idx) => {
      let distance = 0;
      let isFirst = false;

      if (idx === 0) {
        isFirst = true;
      } else if (prev && typeof prev.odometer === "number") {
        const d = (log.odometer || 0) - (prev.odometer || 0);
        if (d > 0) distance = d;
        else isFirst = true;
      }

      const totalFuel = parseFloat(log.fuel) || 0;
      const efficiency = distance > 0 && totalFuel > 0 ? distance / totalFuel : 0;

      const enriched = { ...log, distance, totalFuel, efficiency, isFirst };
      prev = enriched;
      return enriched;
    });

    if (allLogs.length > 0) {
      const last = allLogs[allLogs.length - 1];
      $("last-odometer-hint").textContent = `最新の記録: ${last.date} / ${fmt1(last.odometer)} km`;
    } else {
      $("last-odometer-hint").textContent = "まだ記録がありません。";
    }

    renderList();
    renderSummary();
    updatePreview();
  };
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.classList.add("active");

  document.querySelectorAll(".tab-content").forEach((v) => v.classList.add("hidden"));
  $(`view-${tab}`).classList.remove("hidden");

  if (tab === "list") renderList();
  if (tab === "summary") renderSummary();
}

function updatePreview() {
  const card = $("fuel-preview-card");

  if (allLogs.length === 0) {
    card.classList.remove("visible");
    return;
  }

  const date = $("date").value || "";
  const odo = parseFloat($("odometer").value);
  const fuel = parseFloat($("fuel").value) || 0;

  if (!date || Number.isNaN(odo) || fuel <= 0) {
    card.classList.remove("visible");
    return;
  }

  const sortBase = [
    ...allLogs.map((l) => ({ id: l.id, date: l.date, odometer: l.odometer })),
    { id: -1, date, odometer: odo },
  ];

  sortBase.sort((a, b) => {
    if (a.date === b.date) return (a.odometer || 0) - (b.odometer || 0);
    return a.date < b.date ? -1 : 1;
  });

  const idx = sortBase.findIndex((l) => l.id === -1);
  if (idx <= 0) {
    card.classList.remove("visible");
    return;
  }

  const prev = sortBase[idx - 1];
  const dist = odo - (prev.odometer || 0);
  if (dist <= 0) {
    card.classList.remove("visible");
    return;
  }

  $("preview-distance").textContent = fmt1(dist);
  $("preview-fuel").textContent = fuel.toFixed(2);
  $("preview-efficiency").textContent = (dist / fuel).toFixed(2) + " km/L";
  card.classList.add("visible");
}

function renderList() {
  const container = $("logs-container");
  container.innerHTML = "";

  if (allLogs.length === 0) {
    container.innerHTML = `<p class="muted center pad">まだデータがありません。</p>`;
    return;
  }

  // イベント委譲（ボタンが増えても壊れにくい）
  container.onclick = (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === "edit") editLog(id);
    if (btn.dataset.action === "delete") deleteLog(id);
  };

  [...allLogs].slice().reverse().forEach((log) => {
    const effText = log.isFirst || log.efficiency <= 0 ? "-" : log.efficiency.toFixed(2);
    const distText = log.isFirst || log.distance <= 0 ? "(初回)" : `+${fmt1(log.distance)} km`;
    const fuelText = log.totalFuel > 0 ? log.totalFuel.toFixed(2) : "-";

    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="log-card">
        <div class="log-header">
          <div class="log-date">${esc(log.date || "")}</div>
          <div class="log-actions">
            <button class="btn-small" type="button" data-action="edit" data-id="${log.id}">編集</button>
            <button class="btn-danger" type="button" data-action="delete" data-id="${log.id}">削除</button>
          </div>
        </div>

        <div class="log-main">
          <div>
            <div style="font-size:.8rem;color:#6b7280;">今回燃費</div>
            <div class="log-km">${effText} <span style="font-size:.85rem;">km/L</span></div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:.8rem;color:#6b7280;">走行距離</div>
            <div style="font-weight:900;">${distText}</div>
          </div>
        </div>

        <div class="log-meta">
          <div>
            <div style="font-size:.75rem;color:#6b7280;">積算距離</div>
            <div style="font-weight:800;">${fmt1(log.odometer)} km</div>
          </div>
          <div>
            <div style="font-size:.75rem;color:#6b7280;">給油量</div>
            <div><span class="badge">${fuelText} L</span></div>
          </div>
        </div>

        ${log.memo ? `<div style="margin-top:.6rem;background:#f9fafb;padding:.35rem .5rem;border-radius:8px;font-size:.85rem;">${esc(log.memo)}</div>` : ""}
      </div>
      `
    );
  });
}

function editLog(id) {
  const log = allLogs.find((l) => l.id === id);
  if (!log) return;

  editingId = id;
  $("date").value = log.date;
  $("odometer").value = log.odometer;
  $("fuel").value = log.fuel || "";
  $("memo").value = log.memo || "";
  $("submitButton").textContent = "✏️ 記録を更新する";
  switchTab("input");
  updatePreview();
}

function deleteLog(id) {
  if (!db) return;
  if (!confirm("この記録を削除しますか？")) return;

  const tx = db.transaction([STORE_NAME], "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  tx.oncomplete = () => {
    showToast("削除しました。");
    loadLogs();
  };
}

function deleteAllLogs() {
  if (!db) return;
  if (!confirm("本当に全データを削除しますか？")) return;

  const tx = db.transaction([STORE_NAME], "readwrite");
  tx.objectStore(STORE_NAME).clear();
  tx.oncomplete = () => {
    allLogs = [];
    renderList();
    renderSummary();
    showToast("全データを削除しました。");
  };
}

function renderSummary() {
  const month = $("summaryMonth").value;
  const container = $("summary-content");
  if (!month) return;

  const monthly = allLogs.filter((l) => (l.date || "").startsWith(month));
  if (monthly.length === 0) {
    container.innerHTML = `<p class="muted center pad">データなし</p>`;
    return;
  }

  let dist = 0;
  let fuel = 0;

  monthly.forEach((l) => {
    if (!l.isFirst && l.distance > 0 && l.totalFuel > 0) {
      dist += l.distance;
      fuel += l.totalFuel;
    }
  });

  const avg = dist > 0 && fuel > 0 ? (dist / fuel).toFixed(2) : "-";

  container.innerHTML = `
    <div class="card" style="border-left-color: var(--primary); background: var(--primary); color:#fff;">
      <div style="font-weight:900;">月平均燃費</div>
      <div style="font-size:2rem;font-weight:900;margin:.3rem 0;">
        ${avg} <span style="font-size:.95rem;">km/L</span>
      </div>
      <div style="opacity:.9;">${month}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.8rem;">
        <div style="background:rgba(255,255,255,.14);padding:.7rem;border-radius:10px;">
          <div style="opacity:.9;font-size:.85rem;">総走行距離</div>
          <div style="font-weight:900;font-size:1.1rem;">${fmt1(dist)} km</div>
        </div>
        <div style="background:rgba(255,255,255,.14);padding:.7rem;border-radius:10px;">
          <div style="opacity:.9;font-size:.85rem;">総給油量</div>
          <div style="font-weight:900;font-size:1.1rem;">${fuel.toFixed(2)} L</div>
        </div>
      </div>
    </div>
  `;
}

/* CSV */

function importCSV() {
  const file = $("csvFile").files?.[0];
  if (!file) {
    showToast("CSVファイルを選んでください。");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => parseAndImport(String(e.target.result || ""));
  reader.readAsText(file, "UTF-8");
}

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseAndImport(csv) {
  if (!db) return;

  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    showToast("有効なデータが見つかりません。");
    return;
  }

  const header = parseCSVLine(lines[0]).map(cleanCell);

  let dateIdx = 0, odoIdx = 1, fuelIdx = 2, memoIdx = -1;

  header.forEach((name, i) => {
    if (/(日付|date)/i.test(name)) dateIdx = i;
    if (/(距離|積算|オド|メータ)/.test(name)) odoIdx = i;
    if (/(給油|燃料|量|L|ℓ)/i.test(name)) fuelIdx = i;
    if (/(メモ|備考|note)/i.test(name)) memoIdx = i;
  });

  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]).map(cleanCell);
    if (!cols[dateIdx] && !cols[odoIdx]) continue;

    const date = (cols[dateIdx] || "").replace(/\./g, "-").replace(/\//g, "-");
    const odoStr = numOnly(toHalfWidth(cols[odoIdx] || ""));
    const fuelStr = numOnly(toHalfWidth(cols[fuelIdx] || ""));

    const odometer = parseFloat(odoStr);
    const fuel = parseFloat(fuelStr);

    if (!date || Number.isNaN(odometer) || Number.isNaN(fuel)) continue;

    records.push({
      date,
      odometer,
      fuel,
      memo: memoIdx >= 0 ? (cols[memoIdx] || "") : `CSV行${i + 1}`,
      timestamp: Date.now(),
    });
  }

  if (records.length === 0) {
    showToast("取り込める行がありませんでした。");
    return;
  }

  const existingKey = new Set(allLogs.map((l) => `${l.date}|${l.odometer}`));
  const toImport = records.filter((r) => !existingKey.has(`${r.date}|${r.odometer}`));

  if (toImport.length === 0) {
    showToast("新規データはありませんでした。");
    return;
  }

  const tx = db.transaction([STORE_NAME], "readwrite");
  const store = tx.objectStore(STORE_NAME);
  toImport.forEach((r) => store.add(r));

  tx.oncomplete = () => {
    showToast(`${toImport.length}件インポートしました。`);
    $("csvFile").value = "";
    loadLogs();
  };
}

function exportCSV() {
  if (allLogs.length === 0) {
    showToast("データがありません。");
    return;
  }

  let csv = "日付,積算距離,走行距離,給油量,燃費,メモ\n";
  allLogs.forEach((l) => {
    const eff = l.isFirst ? "" : l.efficiency.toFixed(2);
    csv += [
      l.date,
      l.odometer,
      l.isFirst ? 0 : l.distance,
      (l.totalFuel || 0).toFixed(2),
      eff,
      `"${String(l.memo || "").replace(/"/g, '""')}"`
    ].join(",") + "\n";
  });

  const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "cub_log.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* utils */

function showToast(msg) {
  const el = $("notification");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 3500);
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[c]);
}

function fmt1(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function toHalfWidth(str) {
  return String(str || "").replace(/[０-９．，]/g, (ch) => {
    if (ch === "．") return ".";
    if (ch === "，") return ",";
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
}

function cleanCell(c) {
  return String(c || "").replace(/^"|"$/g, "").trim();
}

function numOnly(s) {
  return String(s || "")
    .replace(/,/g, "")
    .replace(/[^0-9.\-]/g, "");
}
