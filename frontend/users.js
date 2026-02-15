// users.js (REWRITE) - Executive Users Dashboard (Robust)
// - รองรับ key หลายแบบจาก API (member_tier_summary / memberships_summary)
// - ไม่พึ่ง genderSelect (ใน users.html ถูกคอมเมนต์)
// - สร้าง radio list: คณะ / ชั้นปี จาก res.meta
// - ใช้ ExecCommon.apiGet + ExecCommon.requireExecutive()

function $id(id) { return document.getElementById(id); }
function fmtNum(n) { return Number(n || 0).toLocaleString("th-TH"); }
function fmtMoney(n) { return Number(n || 0).toLocaleString("th-TH") + " ฿"; }

const API_FILE = "get_users_dashboard.php";
const META_FILE = "get_meta.php";

let chartFaculty = null;
let chartStudyYear = null;
let chartPeak = null;
let mode = "peak";

function destroyChart(ch) { try { ch?.destroy(); } catch { } return null; }

function getRange() {
  return document.querySelector('input[name="range"]:checked')?.value || "all";
}
function getRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "ALL";
}
function getSelectText(id) {
  const el = $id(id);
  if (!el) return "ทั้งหมด";
  return el.options?.[el.selectedIndex]?.textContent?.trim() || "ทั้งหมด";
}

/* =========================
   Date range UI
========================= */
function setupCustomDateBox() {
  const box = $id("customDateBox");
  if (!box) return;

  const sync = () => {
    box.style.display = (getRange() === "custom") ? "block" : "none";
  };
  document.querySelectorAll('input[name="range"]').forEach(r => r.addEventListener("change", sync));
  sync();
}

/* =========================
   Build query params for API
========================= */
function getParams() {
  const p = {};

  const branch = $id("branchSelect")?.value || "ALL";
  const region = $id("regionSelect")?.value || "ALL";
  const ay = $id("academicYear")?.value || "ALL";

  if (branch !== "ALL" && branch !== "") p.branch_id = branch;
  if (region !== "ALL" && region !== "") p.region = region;
  if (ay !== "ALL" && ay !== "") p.academic_year = ay;

  const range = getRange();
  p.range = range;

  if (range === "custom") {
    const from = $id("fromDate")?.value || "";
    const to = $id("toDate")?.value || "";
    if (from) p.from = from;
    if (to) p.to = to;
  }

  const faculty = getRadioValue("faculty");
  const sy = getRadioValue("studyYear");
  if (faculty !== "ALL") p.faculties = String(faculty);
  if (sy !== "ALL") p.study_years = String(sy);

  return p;
}

/* =========================
   Filter chips (top row)
========================= */
function rangeText() {
  const r = getRange();
  if (r === "all") return "ทั้งหมด";
  if (r === "today") return "วันนี้";
  if (r === "7d") return "7 วันที่ผ่านมา";
  if (r === "30d") return "30 วันที่ผ่านมา";
  if (r === "custom") return "กำหนดเอง";
  return r;
}
function customDateText() {
  if (getRange() !== "custom") return "";
  const from = $id("fromDate")?.value || "";
  const to = $id("toDate")?.value || "";
  if (from && to) return `${from} → ${to}`;
  if (from) return `เริ่ม ${from}`;
  if (to) return `ถึง ${to}`;
  return "";
}
function renderFilterChips() {
  const wrap = $id("filterChips");
  if (!wrap) return;

  const ay = $id("academicYear")?.value || "ALL";
  const cd = customDateText();

  const chips = [
    { k: "ภูมิภาค", v: getSelectText("regionSelect"), cls: "gray" },
    { k: "สาขา", v: getSelectText("branchSelect"), cls: "gray" },
    { k: "ปี", v: (ay === "ALL" ? "ทั้งหมด" : ay), cls: "gray" },
    { k: "ช่วงเวลา", v: cd ? `${rangeText()} (${cd})` : rangeText(), cls: "orange" },
    { k: "คณะ", v: facultyLabelFromRadio(), cls: "gray" },
    { k: "ชั้นปี", v: studyYearLabelFromRadio(), cls: "gray" },
  ];

  wrap.innerHTML = chips.map(c => `
    <div class="chip ${c.cls}">
      <span class="k">${c.k}:</span>
      <span class="v">${c.v}</span>
    </div>
  `).join("");
}

function facultyLabelFromRadio() {
  const v = getRadioValue("faculty");
  if (v === "ALL") return "ทั้งหมด";
  // label text
  const el = document.querySelector(`input[name="faculty"][value="${CSS.escape(String(v))}"]`);
  const label = el?.closest("label")?.textContent?.trim();
  return label ? label.replace(/\s+/g, " ") : String(v);
}
function studyYearLabelFromRadio() {
  const v = getRadioValue("studyYear");
  if (v === "ALL") return "ทั้งหมด";
  const el = document.querySelector(`input[name="studyYear"][value="${CSS.escape(String(v))}"]`);
  const label = el?.closest("label")?.textContent?.trim();
  return label ? label.replace(/\s+/g, " ") : String(v);
}

/* =========================
   Charts
========================= */
function drawBar(canvasId, labels, data) {
  const c = $id(canvasId);
  if (!c || !window.Chart) return null;

  return new Chart(c.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "จำนวน",
        data,
        borderRadius: 8,
        barThickness: 28,
        maxBarThickness: 44,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

/* =========================
   KPI
========================= */
function setKPI(kpi) {
  $id("kpiTotalUsage") && ($id("kpiTotalUsage").textContent = fmtNum(kpi.total_usage || 0));
  $id("kpiTopFacultyName") && ($id("kpiTopFacultyName").textContent = kpi?.top_faculty?.name || "-");
  $id("kpiTopFacultyCount") && ($id("kpiTopFacultyCount").textContent = fmtNum(kpi?.top_faculty?.count || 0));

  const rate = Number(kpi.usage_rate || 0);
  $id("kpiUsageRate") && ($id("kpiUsageRate").textContent = rate.toFixed(1));
  $id("kpiUsageBar") && ($id("kpiUsageBar").style.width = Math.max(0, Math.min(100, rate)) + "%");
}

/* =========================
   Top Equipment
========================= */
function renderTopEquipment(items) {
  const wrap = $id("topEquipmentList");
  if (!wrap) return;

  items = Array.isArray(items) ? items : [];
  if (!items.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</div>`;
    return;
  }

  const max = Math.max(...items.map(x => Number(x.count || 0)), 1);
  wrap.innerHTML = items.slice(0, 5).map((it, i) => {
    const w = ((Number(it.count || 0) * 100) / max).toFixed(1);
    return `
      <div style="margin:10px 0;">
        <div class="row">
          <div style="font-weight:900;">#${i + 1} ${it.name || "-"}</div>
          <div style="font-weight:900;">${fmtNum(it.count || 0)} ครั้ง</div>
        </div>
        <div class="bar"><div style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

/* =========================
   NEW: Member Tier Summary
   รองรับหลายชื่อ:
   - member_tier_summary
   - memberships_summary  ✅ ของคุณในภาพ
========================= */
function renderMemberTier(rows) {
  const tb = $id("memberTierTbody");
  if (!tb) return;

  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => {
    const tier = r.tier_name || r.member_tier || r.tier || r.level || "-";
    const bookings = (r.total_bookings ?? r.booking_count ?? r.bookings ?? r.count ?? 0);
    const spent = (r.total_spent ?? r.total_amount ?? r.spend ?? r.net_amount ?? r.amount ?? 0);
    return `
      <tr>
        <td>${tier}</td>
        <td class="tr">${fmtNum(bookings)}</td>
        <td class="tr">${fmtNum(spent)} ฿</td>
      </tr>
    `;
  }).join("");
}

/* =========================
   NEW: Student Coupon Top
========================= */
function renderStudentCouponTop(rows) {
  const wrap = $id("studentCouponTop");
  if (!wrap) return;

  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</div>`;
    return;
  }

  const max = Math.max(...rows.map(x => Number(x.count || x.used_count || 0)), 1);

  wrap.innerHTML = rows.slice(0, 5).map((it, i) => {
    const code = it.coupon_code || it.code || it.coupon || "-";
    const c = Number(it.count || it.used_count || 0);
    const w = ((c * 100) / max).toFixed(1);
    return `
      <div style="margin:10px 0;">
        <div class="row">
          <div style="font-weight:900;">#${i + 1} ${code}</div>
          <div style="font-weight:900;">${fmtNum(c)} ครั้ง</div>
        </div>
        <div class="bar"><div style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

/* =========================
   NEW: Payment Method Summary
========================= */
function renderPaymentMethod(rows) {
  const tb = $id("paymentMethodTbody");
  if (!tb) return;

  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => {
    const name = r.method_name || r.method || r.name || "-";
    const cnt = (r.tx_count ?? r.count ?? r.used_count ?? 0);
    const amt = (r.net_amount ?? r.amount ?? r.total ?? 0);
    return `
      <tr>
        <td>${name}</td>
        <td class="tr">${fmtNum(cnt)}</td>
        <td class="tr">${fmtNum(amt)} ฿</td>
      </tr>
    `;
  }).join("");
}

/* =========================
   Meta: branches/regions
========================= */
async function loadBranchRegionMeta() {
  const meta = await ExecCommon.apiGet(META_FILE, {});
  if (!meta || !meta.success) return;

  const rs = $id("regionSelect");
  if (rs) {
    const keep = rs.value || "ALL";
    rs.innerHTML =
      `<option value="ALL">ทั้งหมด</option>` +
      (meta.regions || []).map(r => `<option value="${r.region}">${r.region}</option>`).join("");
    rs.value = keep;
  }

  const bs = $id("branchSelect");
  if (bs) {
    const keep = bs.value || "ALL";
    bs.innerHTML =
      `<option value="ALL">ทั้งหมด</option>` +
      (meta.branches || []).map(b => `<option value="${b.branch_id}">${b.branch_id} • ${b.name}</option>`).join("");
    bs.value = keep;
  }
}

/* =========================
   Build radio lists: faculty & study year
========================= */
function renderFacultyRadioList(faculties) {
  const wrap = $id("facultyList");
  if (!wrap) return;

  faculties = Array.isArray(faculties) ? faculties : [];
  const items = [{ id: "ALL", name: "ทั้งหมด" }, ...faculties];

  wrap.innerHTML = items.map(it => `
    <label class="item-radio">
      <input type="radio" name="faculty" value="${it.id}" ${String(it.id) === "ALL" ? "checked" : ""}>
      <span style="font-weight:900;">${it.name}</span>
    </label>
  `).join("");

  wrap.querySelectorAll('input[name="faculty"]').forEach(r => {
    r.addEventListener("change", () => load(false));
  });
}

function renderStudyYearRadioList(years) {
  const wrap = $id("studyYearList");
  if (!wrap) return;

  years = Array.isArray(years) ? years : [];
  const items = ["ALL", ...years];

  wrap.innerHTML = items.map(v => `
    <label class="item-radio">
      <input type="radio" name="studyYear" value="${v}" ${String(v) === "ALL" ? "checked" : ""}>
      <span style="font-weight:900;">${String(v) === "ALL" ? "ทั้งหมด" : ("ปี " + v)}</span>
    </label>
  `).join("");

  wrap.querySelectorAll('input[name="studyYear"]').forEach(r => {
    r.addEventListener("change", () => load(false));
  });
}

/* =========================
   Peak/Daily mode
========================= */
function setMode(next) {
  mode = next;
  $id("btnDaily")?.classList.toggle("active", mode === "daily");
  $id("btnPeak")?.classList.toggle("active", mode === "peak");
}

/* =========================
   Main load
========================= */
async function load(first) {
  renderFilterChips();

  const res = await ExecCommon.apiGet(API_FILE, getParams());
  if (!res || !res.success) {
    // แสดง fallback ถ้าโหลดไม่ได้
    renderMemberTier([]);
    renderStudentCouponTop([]);
    renderPaymentMethod([]);
    return;
  }

  // สร้างปีการศึกษาใน dropdown
  if (first) {
    const sel = $id("academicYear");
    const years = res?.meta?.academic_years;
    if (sel && Array.isArray(years)) {
      const keep = sel.value || "ALL";
      sel.innerHTML =
        `<option value="ALL">ทั้งหมด</option>` +
        years.map(y => `<option value="${y}">${y}</option>`).join("");
      sel.value = keep;
    }

    // สร้าง radio list: คณะ / ชั้นปี
    renderFacultyRadioList(res?.meta?.faculties || []);
    renderStudyYearRadioList(res?.meta?.study_years || []);
  }

  // KPI + Top
  setKPI(res.kpi || {});
  renderTopEquipment(res.top_equipment || []);

  // ✅ NEW sections (รองรับชื่อ key หลายแบบ)
  const tierRows =
    res.member_tier_summary ||
    res.memberships_summary ||   // ✅ ของคุณ
    res.member_tier ||
    [];
  renderMemberTier(tierRows);

  renderStudentCouponTop(res.student_coupon_top || res.student_coupon || []);
  renderPaymentMethod(res.payment_method_summary || res.payment_methods || []);

  // Charts
  chartFaculty = destroyChart(chartFaculty);
  chartStudyYear = destroyChart(chartStudyYear);
  chartPeak = destroyChart(chartPeak);

  const facRows = Array.isArray(res.by_faculty) ? res.by_faculty : [];
  if ($id("chartFaculty")) {
    chartFaculty = drawBar(
      "chartFaculty",
      facRows.map(r => r.faculty || r.name || "-"),
      facRows.map(r => Number(r.count || 0))
    );
  }

  const syRows = Array.isArray(res.by_study_year) ? res.by_study_year : [];
  if ($id("chartStudyYear")) {
    chartStudyYear = drawBar(
      "chartStudyYear",
      syRows.map(r => "ปี " + (r.study_year ?? r.year ?? "-")),
      syRows.map(r => Number(r.count || 0))
    );
  }

  if ($id("chartPeak")) {
    if (mode === "daily") {
      const labels = res.daily_usage?.labels || [];
      const data = res.daily_usage?.counts || [];
      chartPeak = drawBar("chartPeak", labels, data.map(x => Number(x || 0)));
    } else {
      const pkRows = Array.isArray(res.peak_time) ? res.peak_time : [];
      chartPeak = drawBar(
        "chartPeak",
        pkRows.map(r => r.label || "-"),
        pkRows.map(r => Number(r.count || 0))
      );
    }
  }

  renderFilterChips();
}

/* =========================
   Bind UI
========================= */
function bindUI() {
  $id("btnApply")?.addEventListener("click", () => load(false));
  $id("btnReset")?.addEventListener("click", () => location.reload());

  ["branchSelect", "regionSelect", "academicYear", "fromDate", "toDate"].forEach(id => {
    $id(id)?.addEventListener("change", () => load(false));
  });

  document.querySelectorAll('input[name="range"]').forEach(r => {
    r.addEventListener("change", () => load(false));
  });

  $id("btnDaily")?.addEventListener("click", () => { setMode("daily"); load(false); });
  $id("btnPeak")?.addEventListener("click", () => { setMode("peak"); load(false); });
}

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await ExecCommon.requireExecutive();
  if (!ok) return;

  await loadBranchRegionMeta();
  setupCustomDateBox();
  bindUI();
  setMode("peak");
  await load(true);
});