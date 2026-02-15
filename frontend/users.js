// users.js - executive insights for Users page
// ✅ keeps existing charts + adds:
// - membership tier summary (bookings + spend)
// - most used coupon among students
// - payment method summary (count + spend)
// ✅ safe fallback if API doesn't send these fields yet

function $id(id) { return document.getElementById(id); }
function fmtNum(n){ return Number(n||0).toLocaleString("th-TH"); }
function fmtMoney(n){
  const v = Number(n||0);
  return v.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " ฿";
}

const API_FILE  = "get_users_dashboard.php";
const META_FILE = "get_meta.php";

let chartFaculty = null;
let chartStudyYear = null;
let chartPeak = null;
let mode = "peak";

function destroyChart(ch){ try{ ch?.destroy(); }catch{} return null; }

function getRange(){
  return document.querySelector('input[name="range"]:checked')?.value || "all";
}
function getRadioValue(name){
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "ALL";
}
function getSelectText(id){
  const el = $id(id);
  if (!el) return "ทั้งหมด";
  return el.options?.[el.selectedIndex]?.textContent?.trim() || "ทั้งหมด";
}

function setupCustomDateBox(){
  const box = $id("customDateBox");
  if (!box) return;

  const sync = () => {
    box.style.display = (getRange() === "custom") ? "block" : "none";
  };

  document.querySelectorAll('input[name="range"]').forEach(r=>{
    r.addEventListener("change", sync);
  });
  sync();
}

function getParams(){
  const p = {};
  const ay = $id("academicYear")?.value || "ALL";
  if (ay !== "ALL" && ay !== "") p.academic_year = ay;

  const range = getRange();
  p.range = range;

  if (range === "custom") {
    const from = $id("fromDate")?.value || "";
    const to   = $id("toDate")?.value || "";
    if (from) p.from = from;
    if (to) p.to = to;
  }

  const faculty = getRadioValue("faculty");
  const sy      = getRadioValue("studyYear");
  if (faculty !== "ALL") p.faculties = String(faculty);
  if (sy !== "ALL")      p.study_years = String(sy);

  // ❗ สาขา/ภูมิภาค/เพศ: ตอนนี้ใช้โชว์ใน chips ก่อน (ยังไม่ส่งไป API)
  return p;
}

/* ==========================
   Filter chips summary
========================== */
function rangeText(){
  const r = getRange();
  if (r === "all") return "ทั้งหมด";
  if (r === "today") return "วันนี้";
  if (r === "7d") return "7 วันที่ผ่านมา";
  if (r === "30d") return "30 วันที่ผ่านมา";
  if (r === "custom") return "กำหนดเอง";
  return r;
}
function facultyText(){
  const v = getRadioValue("faculty");
  if (v === "ALL") return "ทั้งหมด";
  const el = document.querySelector(`input[name="faculty"][value="${v}"]`);
  return el?.closest("label")?.innerText?.trim()?.replace(/\s+/g," ") || v;
}
function studyYearText(){
  const v = getRadioValue("studyYear");
  if (v === "ALL") return "ทั้งหมด";
  return `ปี ${v}`;
}
function customDateText(){
  if (getRange() !== "custom") return "";
  const from = $id("fromDate")?.value || "";
  const to   = $id("toDate")?.value || "";
  if (from && to) return `${from} → ${to}`;
  if (from) return `เริ่ม ${from}`;
  if (to) return `ถึง ${to}`;
  return "";
}
function renderFilterChips(){
  const wrap = $id("filterChips");
  if (!wrap) return;

  const ay = $id("academicYear")?.value || "ALL";
  const cd = customDateText();

  const chips = [
    {k:"สาขา", v:getSelectText("branchSelect"), cls:"gray"},
    {k:"ภูมิภาค", v:getSelectText("regionSelect"), cls:"gray"},
    {k:"เพศ", v:getSelectText("genderSelect"), cls:"gray"},
    {k:"ปี", v:(ay === "ALL" ? "ทั้งหมด" : ay), cls:"gray"},
    {k:"ช่วงเวลา", v: cd ? `${rangeText()} (${cd})` : rangeText(), cls:"orange"},
    {k:"คณะ", v: facultyText(), cls:"gray"},
    {k:"ชั้นปี", v: studyYearText(), cls:"gray"},
  ];

  wrap.innerHTML = chips.map(c => `
    <div class="chip ${c.cls}">
      <span class="k">${c.k}:</span>
      <span class="v">${c.v}</span>
    </div>
  `).join("");
}

/* ==========================
   Draw charts
========================== */
function drawBar(canvasId, labels, data){
  const c = $id(canvasId);
  if (!c || !window.Chart) return null;

  return new Chart(c.getContext("2d"), {
    type: "bar",
    data: { labels, datasets: [{ label:"จำนวน", data, borderRadius: 8, barThickness: 28, maxBarThickness: 44 }] },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{ display:false }, ticks:{ maxRotation:0 } },
        y:{ beginAtZero:true, ticks:{ precision:0 } }
      }
    }
  });
}

/* ==========================
   NEW: Executive insights renderers
   Expect API (optional fields):
   - res.membership_summary: [{tier:"Gold", bookings: 12, spend: 3400}, ...]
   - res.student_coupon_top: [{coupon_code:"STU10", coupon_name:"...", count: 9, discount_total: 300}, ...]
   - res.payment_method_summary: [{method:"QR", count: 20, amount: 5000}, ...]
========================== */
function renderMembershipSummary(res){
  const tb = $id("memberTierTbody");
  if (!tb) return;

  const rows = Array.isArray(res?.membership_summary) ? res.membership_summary : [];
  if (!rows.length){
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ยังไม่มีข้อมูลจาก API (membership_summary)</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.tier || r.level || "-"}</td>
      <td class="tr">${fmtNum(r.bookings || r.booking_count || 0)}</td>
      <td class="tr">${fmtMoney(r.spend || r.amount || r.total_amount || 0)}</td>
    </tr>
  `).join("");
}

function renderStudentCouponTop(res){
  const wrap = $id("studentCouponTop");
  if (!wrap) return;

  const rows = Array.isArray(res?.student_coupon_top) ? res.student_coupon_top : [];
  if (!rows.length){
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ยังไม่มีข้อมูลจาก API (student_coupon_top)</div>`;
    return;
  }

  const max = Math.max(...rows.map(x=>Number(x.count||0)), 1);
  wrap.innerHTML = rows.slice(0,5).map((r,i)=>{
    const title = r.coupon_name ? `${r.coupon_code} • ${r.coupon_name}` : (r.coupon_code || r.code || "-");
    const cnt = Number(r.count || 0);
    const w = ((cnt*100)/max).toFixed(1);
    const discount = r.discount_total != null ? `ส่วนลดรวม ${fmtMoney(r.discount_total)}` : "";
    return `
      <div style="margin:10px 0;">
        <div class="row">
          <div style="font-weight:900;">#${i+1} ${title}</div>
          <div style="font-weight:900;">${fmtNum(cnt)} ครั้ง</div>
        </div>
        ${discount ? `<div style="color:#6b7280;font-weight:900;font-size:11px;margin-top:-6px;">${discount}</div>` : ``}
        <div class="bar"><div style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

function renderPaymentMethodSummary(res){
  const tb = $id("paymentMethodTbody");
  if (!tb) return;

  const rows = Array.isArray(res?.payment_method_summary) ? res.payment_method_summary : [];
  if (!rows.length){
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ยังไม่มีข้อมูลจาก API (payment_method_summary)</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.method || r.method_name || "-"}</td>
      <td class="tr">${fmtNum(r.count || 0)}</td>
      <td class="tr">${fmtMoney(r.amount || r.total || 0)}</td>
    </tr>
  `).join("");
}

/* ==========================
   Meta dropdown (branch/region)
========================== */
async function loadBranchRegionMeta(){
  const meta = await ExecCommon.apiGet(META_FILE, {});
  if (!meta || !meta.success) return;

  const bs = $id("branchSelect");
  if (bs) {
    const keep = bs.value || "ALL";
    bs.innerHTML =
      `<option value="ALL">ทั้งหมด</option>` +
      (meta.branches || []).map(b => `<option value="${b.branch_id}">${b.branch_id} • ${b.name}</option>`).join("");
    bs.value = keep;
  }

  const rs = $id("regionSelect");
  if (rs) {
    const keep = rs.value || "ALL";
    rs.innerHTML =
      `<option value="ALL">ทั้งหมด</option>` +
      (meta.regions || []).map(r => `<option value="${r.region}">${r.region}</option>`).join("");
    rs.value = keep;
  }
}

/* ==========================
   Render meta from API users dashboard
========================== */
function renderMeta(meta){
  const sel = $id("academicYear");
  if (sel && Array.isArray(meta?.academic_years)) {
    const years = meta.academic_years;
    sel.innerHTML = `<option value="ALL">ทั้งหมด</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
    if (years.length) sel.value = String(years[0]);
  }

  const facBox = $id("facultyList");
  if (facBox && Array.isArray(meta?.faculties)) {
    facBox.innerHTML =
      `<label class="item-radio"><input type="radio" name="faculty" value="ALL" checked><span>ทั้งหมด</span></label>` +
      meta.faculties.map(f => `
        <label class="item-radio">
          <input type="radio" name="faculty" value="${f.id}">
          <span>${f.name}</span>
        </label>
      `).join("");
  }

  const syBox = $id("studyYearList");
  if (syBox && Array.isArray(meta?.study_years)) {
    syBox.innerHTML =
      `<label class="item-radio"><input type="radio" name="studyYear" value="ALL" checked><span>ทั้งหมด</span></label>` +
      meta.study_years.map(y => `
        <label class="item-radio">
          <input type="radio" name="studyYear" value="${y}">
          <span>ปี ${y}</span>
        </label>
      `).join("");
  }
}

/* ==========================
   KPI + Top equipment
========================== */
function setKPI(kpi){
  $id("kpiTotalUsage") && ($id("kpiTotalUsage").textContent = fmtNum(kpi.total_usage));
  $id("kpiTopFacultyName") && ($id("kpiTopFacultyName").textContent = kpi?.top_faculty?.name || "-");
  $id("kpiTopFacultyCount") && ($id("kpiTopFacultyCount").textContent = fmtNum(kpi?.top_faculty?.count || 0));

  const rate = Number(kpi.usage_rate || 0);
  $id("kpiUsageRate") && ($id("kpiUsageRate").textContent = rate.toFixed(1));
  $id("kpiUsageBar") && ($id("kpiUsageBar").style.width = Math.max(0, Math.min(100, rate)) + "%");
}

function renderTop(items){
  const wrap = $id("topEquipmentList");
  if (!wrap) return;

  items = Array.isArray(items) ? items : [];
  if (!items.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</div>`;
    return;
  }

  const max = Math.max(...items.map(x=>Number(x.count||0)), 1);

  wrap.innerHTML = items.slice(0,5).map((it,i)=>{
    const w = ((Number(it.count||0)*100)/max).toFixed(1);
    return `
      <div style="margin:10px 0;">
        <div class="row">
          <div style="font-weight:900;">#${i+1} ${it.name || "-"}</div>
          <div style="font-weight:900;">${fmtNum(it.count)} ครั้ง</div>
        </div>
        <div class="bar"><div style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

function setMode(next){
  mode = next;
  $id("btnDaily")?.classList.toggle("active", mode==="daily");
  $id("btnPeak")?.classList.toggle("active", mode==="peak");
}

/* ==========================
   Load all
========================== */
async function load(first){
  renderFilterChips();

  const res = await ExecCommon.apiGet(API_FILE, getParams());
  if (!res || !res.success) return;

  if (first) renderMeta(res.meta || {});
  setKPI(res.kpi || {});
  renderTop(res.top_equipment || []);

  // ✅ Executive insights (safe fallback)
  renderMembershipSummary(res);
  renderStudentCouponTop(res);
  renderPaymentMethodSummary(res);

  // charts
  chartFaculty = destroyChart(chartFaculty);
  chartStudyYear = destroyChart(chartStudyYear);
  chartPeak = destroyChart(chartPeak);

  const facRows = Array.isArray(res.by_faculty) ? res.by_faculty : [];
  chartFaculty = drawBar("chartFaculty", facRows.map(r=>r.faculty), facRows.map(r=>Number(r.count||0)));

  const syRows = Array.isArray(res.by_study_year) ? res.by_study_year : [];
  chartStudyYear = drawBar("chartStudyYear", syRows.map(r=>"ปี "+r.study_year), syRows.map(r=>Number(r.count||0)));

  if (mode === "daily") {
    const labels = res.daily_usage?.labels || [];
    const data   = res.daily_usage?.counts || [];
    chartPeak = drawBar("chartPeak", labels, data.map(x=>Number(x||0)));
  } else {
    const pkRows = Array.isArray(res.peak_time) ? res.peak_time : [];
    chartPeak = drawBar("chartPeak", pkRows.map(r=>r.label), pkRows.map(r=>Number(r.count||0)));
  }

  renderFilterChips();
}

/* ==========================
   Bind UI
========================== */
function bindUI(){
  $id("btnApply")?.addEventListener("click", ()=>load(false));
  $id("btnReset")?.addEventListener("click", ()=>location.reload());

  ["branchSelect","regionSelect","genderSelect","academicYear","fromDate","toDate"].forEach(id=>{
    $id(id)?.addEventListener("change", ()=>load(false));
  });

  document.querySelectorAll('input[name="range"]').forEach(r=>{
    r.addEventListener("change", ()=>load(false));
  });

  document.addEventListener("change", (e)=>{
    if (e.target?.name === "faculty" || e.target?.name === "studyYear") load(false);
  });

  $id("btnDaily")?.addEventListener("click", ()=>{ setMode("daily"); load(false); });
  $id("btnPeak")?.addEventListener("click", ()=>{ setMode("peak"); load(false); });
}

document.addEventListener("DOMContentLoaded", async ()=>{
  const ok = await ExecCommon.requireExecutive();
  if (!ok) return;

  await loadBranchRegionMeta();
  setupCustomDateBox();
  bindUI();
  setMode("peak");
  await load(true);
});