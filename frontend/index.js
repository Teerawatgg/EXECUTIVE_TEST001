/* ==========================
   Executive Dashboard - index.js (FIXED v3)
   ✅ ยึดโครงตาม executive.css (topList / badgeRed)
   ✅ เหลือปุ่มรีเซ็ตปุ่มเดียว (ลบ btnApply)
   ✅ กันกราฟวงกลมไม่ขึ้นเวลา back/กลับหน้าเดิม
========================== */

let chartTrend = null;
let chartEquipmentPie = null;
let chartChannelDaily = null;

// optional legacy charts
let chartBranch = null;
let chartPayPie = null;

const API_BASE = "/sports_rental_system/executive/api/";

function $(sel) { return document.querySelector(sel); }
function $id(id) { return document.getElementById(id); }

function fmtNum(n) {
  const v = Number(n || 0);
  return v.toLocaleString("th-TH");
}
function fmtMoney(n) {
  const v = Number(n || 0);
  return "฿" + v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function safeText(id, text) {
  const el = $id(id);
  if (el) el.textContent = text;
}

async function apiGet(file, params) {
  const qs = params ? new URLSearchParams(params).toString() : "";
  const url = API_BASE + file + (qs ? "?" + qs : "");
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// ✅ รอ canvas พร้อม (กันต้องกดรี)
function renderWhenCanvasReady(canvas, renderFn, tries = 20) {
  if (!canvas) return;
  const w = canvas.clientWidth || 0;
  const h = canvas.clientHeight || 0;

  if ((w === 0 || h === 0) && tries > 0) {
    requestAnimationFrame(() => renderWhenCanvasReady(canvas, renderFn, tries - 1));
    return;
  }
  setTimeout(() => { try { renderFn(); } catch (e) { console.error(e); } }, 30);
}

// ✅ overlay “ไม่พบข้อมูล” (ไม่ทำลาย canvas)
function ensureCanvasEmptyState(canvas, message = "ไม่พบข้อมูล") {
  if (!canvas) return null;
  const wrap = canvas.parentElement;
  if (!wrap) return null;

  let empty = wrap.querySelector(".chart-empty");
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "color:#6b7280;font-weight:900;background:transparent;pointer-events:none;";
    if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
    wrap.appendChild(empty);
  }
  empty.textContent = message;
  return empty;
}

/* ✅ ถ้า canvas ถูกลบไป ให้สร้างกลับมา */
function ensureEquipmentPieCanvas() {
  let c = $id("chartEquipmentPie");
  if (c) return c;

  const legend = $id("equipmentLegend");
  const wrap = legend ? legend.previousElementSibling : null;

  if (wrap && wrap.classList && wrap.classList.contains("chart-wrap")) {
    wrap.innerHTML = `<canvas id="chartEquipmentPie"></canvas>`;
    return $id("chartEquipmentPie");
  }

  const card = legend ? legend.closest(".card") : null;
  const wrap2 = card ? card.querySelector(".chart-wrap") : null;
  if (wrap2) {
    wrap2.innerHTML = `<canvas id="chartEquipmentPie"></canvas>`;
    return $id("chartEquipmentPie");
  }

  return null;
}

/* ==========================
   Filters
========================== */
function getRangeValue() {
  const el = document.querySelector("input[name='range']:checked");
  return el ? el.value : "30d";
}

function getSelectedChannels() {
  const arr = [];
  const w = $id("chWalkin");
  const o = $id("chOnline");
  if (!w || w.checked) arr.push("Walk-in");
  if (!o || o.checked) arr.push("Online");
  return arr.length ? arr : ["Walk-in", "Online"];
}

function getFilters() {
  const range = getRangeValue();
  const branch_id = $id("branchSelect") ? $id("branchSelect").value : "ALL";
  const region = $id("regionSelect") ? $id("regionSelect").value : "ALL";
  const channels = getSelectedChannels().join(",");

  const p = { range, branch_id, region, channels };

  if (range === "custom") {
    const from = $id("fromDate") ? $id("fromDate").value : "";
    const to = $id("toDate") ? $id("toDate").value : "";
    if (from) p.from = from;
    if (to) p.to = to;
  }
  return p;
}

function setupCustomDateBox() {
  const box = $id("customDateBox");
  if (!box) return;

  const sync = () => {
    const range = getRangeValue();
    box.style.display = range === "custom" ? "block" : "none";
  };

  document.querySelectorAll("input[name='range']").forEach(r => {
    r.addEventListener("change", () => { sync(); autoApply(); });
  });

  sync();
}

let applyTimer = null;
function autoApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => loadAll(), 250);
}

function bindFilterEvents() {
  ["branchSelect", "regionSelect", "chWalkin", "chOnline", "fromDate", "toDate"].forEach(id => {
    const el = $id(id);
    if (!el) return;
    el.addEventListener("change", autoApply);
  });

  // ✅ ไม่มี btnApply แล้ว
  const btnReset = $id("btnReset");
  if (btnReset) btnReset.addEventListener("click", () => location.reload());
}

/* ==========================
   Meta
========================== */
async function loadMeta() {
  const meta = await apiGet("get_meta.php");
  if (!meta || !meta.success) return;

  const bs = $id("branchSelect");
  if (bs) {
    const keep = bs.value || "ALL";
    bs.innerHTML =
      `<option value="ALL">ทั้งหมด</option>` +
      (meta.branches || []).map(b =>
        `<option value="${b.branch_id}">${b.branch_id} • ${b.name}</option>`
      ).join("");
    bs.value = keep;
  }

  const rs = $id("regionSelect");
  if (rs) {
    const keep = rs.value || "ALL";
    rs.innerHTML =
      `<option value="ALL">ทั้งหมด</option>` +
      (meta.regions || []).map(r =>
        `<option value="${r.region}">${r.region}</option>`
      ).join("");
    rs.value = keep;
  }
}

/* ==========================
   KPI
========================== */
async function loadKPI(params) {
  const kpi = await apiGet("get_dashboard_kpi.php", params);
  if (!kpi || !kpi.success) return;

  safeText("kpiBookings", fmtNum(kpi.total_bookings));
  safeText("kpiUsers", fmtNum(kpi.total_users));
  safeText("kpiNet", fmtMoney(kpi.net_revenue));
  safeText("kpiPayRate", (Number(kpi.pay_rate || 0)).toFixed(1) + "%");

  safeText("kpiBookingsDelta", "");
  safeText("kpiUsersDelta", "");
  safeText("kpiNetDelta", "");
  safeText("kpiPayRateDelta", "");
}

/* ==========================
   Payment
========================== */
function renderPayList(items) {
  const wrap = $id("payCards");
  if (!wrap) return;

  if (!items || !items.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่พบข้อมูลการชำระเงิน</div>`;
    return;
  }

  wrap.innerHTML = items.map(it => `
    <div style="border:1px solid #eef0f4;border-radius:14px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;background:#fff;">
      <div>
        <div style="font-weight:900;color:#111827;">${it.method_name}</div>
        <div style="font-size:12px;color:#6b7280;font-weight:800;margin-top:2px;">${fmtNum(it.tx_count)} รายการ</div>
      </div>
      <div style="font-weight:900;color:#111827;">${fmtMoney(it.net_amount)}</div>
    </div>
  `).join("");
}

function renderPayTwoCards(items) {
  safeText("payMethodAName", "-"); safeText("payMethodAPct", "-"); safeText("payMethodACount", "-");
  safeText("payMethodBName", "-"); safeText("payMethodBPct", "-"); safeText("payMethodBCount", "-");

  if (!items || !items.length) return;

  const total = items.reduce((s, x) => s + Number(x.tx_count || 0), 0) || 0;
  const sorted = [...items].sort((a, b) => Number(b.tx_count || 0) - Number(a.tx_count || 0));
  const a = sorted[0] || null;
  const b = sorted[1] || null;

  if (a) {
    const pct = total ? (Number(a.tx_count || 0) * 100 / total) : 0;
    safeText("payMethodAName", a.method_name || "-");
    safeText("payMethodAPct", pct.toFixed(0) + "%");
    safeText("payMethodACount", fmtNum(a.tx_count || 0));
  }
  if (b) {
    const pct = total ? (Number(b.tx_count || 0) * 100 / total) : 0;
    safeText("payMethodBName", b.method_name || "-");
    safeText("payMethodBPct", pct.toFixed(0) + "%");
    safeText("payMethodBCount", fmtNum(b.tx_count || 0));
  }
}

async function loadPayment(params) {
  const pay = await apiGet("get_dashboard_payment_summary.php", params);
  if (!pay || !pay.success) {
    renderPayTwoCards([]);
    renderPayList([]);
    return;
  }
  renderPayTwoCards(pay.items);
  renderPayList(pay.items);
  drawLegacyPayPieIfExists(pay.items);
}

/* ==========================
   Region Table
========================== */
function renderRegionTable(rows) {
  const tb = $id("regionTbody");
  if (!tb) return;

  if (!rows || !rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:800;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.region || "-"}</td>
      <td class="tr">${fmtNum(r.bookings || 0)}</td>
      <td class="tr">${fmtMoney(r.net_revenue || 0)}</td>
    </tr>
  `).join("");
}

async function loadRegion(params) {
  const rg = await apiGet("get_dashboard_region_summary.php", params);
  if (!rg || !rg.success) { renderRegionTable([]); return; }
  renderRegionTable(rg.regions);
}

/* ==========================
   Trend
========================== */
function drawTrend(payload) {
  const c = $id("chartTrend");
  if (!c) return;

  const empty = ensureCanvasEmptyState(c, "ไม่พบข้อมูล");

  if (!window.Chart) {
    if (empty) { empty.style.display = "flex"; empty.textContent = "ยังไม่ได้โหลด Chart.js"; }
    return;
  }

  if (!payload || !payload.success) {
    if (chartTrend) { chartTrend.destroy(); chartTrend = null; }
    if (empty) { empty.style.display = "flex"; empty.textContent = "ไม่พบข้อมูล"; }
    return;
  }

  if (empty) empty.style.display = "none";

  if (chartTrend) chartTrend.destroy();
  const ctx = c.getContext("2d");

  chartTrend = new Chart(ctx, {
    type: "line",
    data: {
      labels: payload.labels || [],
      datasets: [
        { label: "การจอง", data: payload.bookings || [], tension: 0.35, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, yAxisID: "y" },
        { label: "รายได้", data: payload.revenue || [], tension: 0.35, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, yAxisID: "y1" }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "จำนวนการจอง" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "รายได้ (บาท)" } }
      },
      plugins: { legend: { position: "bottom" } }
    }
  });
}

async function loadTrend(params) {
  const data = await apiGet("get_dashboard_trend.php", params);
  renderWhenCanvasReady($id("chartTrend"), () => drawTrend(data));
}

/* ==========================
   Top Equipment (Pie + Top 5)
========================== */
function renderTopList(payload) {
  const wrap = $id("topEquipmentList");
  if (!wrap) return;

  if (!payload || !payload.success) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ยังไม่มี API Top 5 (get_dashboard_top_equipment.php)</div>`;
    return;
  }

  const items = payload.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่พบข้อมูล</div>`;
    return;
  }

  wrap.innerHTML = items.slice(0, 5).map((it, idx) => `
    <div class="topItem">
      <div class="topLeft">
        <div class="rank">#${idx + 1}</div>
        <div>
          <div class="topName">${it.name || "-"}</div>
          <div class="topSub">${(it.category || it.type || "") ? (it.category || it.type) + " • " : ""}${fmtNum(it.count || 0)} ครั้ง</div>
        </div>
      </div>

      <!-- ✅ ใช้ badgeRed (ใน executive.css มีจริง) -->
      <div class="badgeRed">${it.status || "ยอดนิยม"}</div>
    </div>
  `).join("");
}

function drawEquipmentPie(payload) {
  const c = ensureEquipmentPieCanvas();
  if (!c) return;

  const empty = ensureCanvasEmptyState(c, "ไม่พบข้อมูล");

  if (!window.Chart) {
    if (empty) { empty.style.display = "flex"; empty.textContent = "ยังไม่ได้โหลด Chart.js"; }
    return;
  }

  if (!payload || !payload.success) {
    if (chartEquipmentPie) { chartEquipmentPie.destroy(); chartEquipmentPie = null; }
    if (empty) { empty.style.display = "flex"; empty.textContent = "ไม่พบข้อมูล"; }
    const legend = $id("equipmentLegend");
    if (legend) legend.innerHTML = "";
    return;
  }

  const items = (payload.items || []).slice(0, 5);
  if (!items.length) {
    if (chartEquipmentPie) { chartEquipmentPie.destroy(); chartEquipmentPie = null; }
    if (empty) { empty.style.display = "flex"; empty.textContent = "ไม่พบข้อมูล"; }
    const legend = $id("equipmentLegend");
    if (legend) legend.innerHTML = "";
    return;
  }

  if (empty) empty.style.display = "none";

  if (chartEquipmentPie) chartEquipmentPie.destroy();
  const ctx = c.getContext("2d");

  chartEquipmentPie = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: items.map(x => x.name),
      datasets: [{ data: items.map(x => Number(x.count || 0)) }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: { legend: { position: "bottom" } }
    }
  });

  const total = items.reduce((s, x) => s + Number(x.count || 0), 0) || 0;
  const legend = $id("equipmentLegend");
  if (legend) {
    legend.innerHTML = items.map(x => {
      const pct = total ? (Number(x.count || 0) * 100 / total) : 0;
      return `<div>• ${x.name} — ${fmtNum(x.count || 0)} ครั้ง (${pct.toFixed(1)}%)</div>`;
    }).join("");
  }

  try { chartEquipmentPie.resize(); chartEquipmentPie.update(); } catch {}
}

async function loadTopEquipment(params) {
  const data = await apiGet("get_dashboard_top_equipment.php", params);
  renderTopList(data);

  const canvas = ensureEquipmentPieCanvas();
  renderWhenCanvasReady(canvas, () => drawEquipmentPie(data));
}

/* ==========================
   Channel Daily
========================== */
function drawChannelDaily(payload) {
  const c = $id("chartChannelDaily");
  if (!c) return;

  const empty = ensureCanvasEmptyState(c, "ไม่พบข้อมูล");

  if (!window.Chart) {
    if (empty) { empty.style.display = "flex"; empty.textContent = "ยังไม่ได้โหลด Chart.js"; }
    return;
  }

  if (!payload || !payload.success) {
    if (chartChannelDaily) { chartChannelDaily.destroy(); chartChannelDaily = null; }
    if (empty) { empty.style.display = "flex"; empty.textContent = "ไม่พบข้อมูล"; }
    safeText("sumOnline", "-");
    safeText("sumWalkin", "-");
    return;
  }

  if (empty) empty.style.display = "none";

  if (chartChannelDaily) chartChannelDaily.destroy();
  const ctx = c.getContext("2d");

  chartChannelDaily = new Chart(ctx, {
    type: "bar",
    data: {
      labels: payload.labels || [],
      datasets: [
        { label: "เคาน์เตอร์หน้าร้าน", data: payload.walkin || [], borderRadius: 8 },
        { label: "เว็บไซต์", data: payload.online || [], borderRadius: 8 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });

  safeText("sumOnline", fmtNum(payload.avg_online ?? "-"));
  safeText("sumWalkin", fmtNum(payload.avg_walkin ?? "-"));
}

async function loadChannelDaily(params) {
  const data = await apiGet("get_dashboard_channel_daily.php", params);
  renderWhenCanvasReady($id("chartChannelDaily"), () => drawChannelDaily(data));
}

/* ==========================
   Legacy (ถ้ามี)
========================== */
function drawLegacyBranchIfExists(rows) {
  const canvas = $id("chartBranch");
  if (!canvas || !window.Chart) return;

  if (chartBranch) chartBranch.destroy();
  const ctx = canvas.getContext("2d");

  rows = rows || [];
  chartBranch = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map(r => r.branch_name),
      datasets: [
        { label: "Walk-in", data: rows.map(r => Number(r.walkin || 0)) },
        { label: "Online", data: rows.map(r => Number(r.online || 0)) }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function drawLegacyPayPieIfExists(items) {
  const canvas = $id("chartPayPie");
  if (!canvas || !window.Chart) return;

  if (chartPayPie) chartPayPie.destroy();
  const ctx = canvas.getContext("2d");

  items = items || [];
  chartPayPie = new Chart(ctx, {
    type: "pie",
    data: { labels: items.map(i => i.method_name), datasets: [{ data: items.map(i => Number(i.tx_count || 0)) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

/* ==========================
   Main load
========================== */
async function loadAll() {
  const params = getFilters();

  await Promise.all([
    loadKPI(params),
    loadPayment(params),
    loadRegion(params),
    loadTrend(params),
    loadTopEquipment(params),
    loadChannelDaily(params),
  ]);

  const br = await apiGet("get_dashboard_branch_channel.php", params);
  if (br && br.success) drawLegacyBranchIfExists(br.branches);
}

/* ==========================
   Buttons
========================== */
function bindTopButtons() {
  const btnPrint = $id("btnPrint");
  if (btnPrint) btnPrint.addEventListener("click", () => window.print());
}

/* ==========================
   Fix: กลับมาหน้าเดิมแล้วกราฟหาย (bfcache/tab back)
========================== */
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    loadAll();
  } else {
    try {
      if (chartEquipmentPie) { chartEquipmentPie.resize(); chartEquipmentPie.update(); }
      if (chartTrend) { chartTrend.resize(); chartTrend.update(); }
      if (chartChannelDaily) { chartChannelDaily.resize(); chartChannelDaily.update(); }
    } catch {}
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    try {
      if (chartEquipmentPie) { chartEquipmentPie.resize(); chartEquipmentPie.update(); }
      if (chartTrend) { chartTrend.resize(); chartTrend.update(); }
      if (chartChannelDaily) { chartChannelDaily.resize(); chartChannelDaily.update(); }
    } catch {}
  }
});

/* ==========================
   Init
========================== */
document.addEventListener("DOMContentLoaded", async () => {
  setupCustomDateBox();
  bindFilterEvents();
  bindTopButtons();

  await loadMeta();
  await loadAll();
});