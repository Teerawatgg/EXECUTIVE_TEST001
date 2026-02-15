// users.js - Executive insights for Users page
// ✅ filters -> API, charts
// ✅ gender chart rule:
//    - เลือกเพศ => แสดงเพศนั้น (แท่งเดียว)
//    - เลือกทั้งหมด => แสดงทุกเพศ (ใช้ by_gender จาก API)
// ✅ NEW sections render:
//    - member_tier_summary -> #memberTierTbody
//    - student_coupon_top  -> #studentCouponTop
//    - payment_method_summary -> #paymentMethodTbody

function $id(id) { return document.getElementById(id); }
function fmtNum(n){ return Number(n||0).toLocaleString("th-TH"); }

const API_FILE  = "get_users_dashboard.php";
const META_FILE = "get_meta.php";

let chartFaculty = null;
let chartStudyYear = null;
let chartPeak = null;
let chartGender = null;
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
  document.querySelectorAll('input[name="range"]').forEach(r => r.addEventListener("change", sync));
  sync();
}

/* ==========================
   Params (filters) -> API
========================== */
function getParams(){
  const p = {};

  const branch = $id("branchSelect")?.value || "ALL";
  const region = $id("regionSelect")?.value || "ALL";
  const gender = $id("genderSelect")?.value || "ALL";

  if (branch !== "ALL" && branch !== "") p.branch_id = branch;
  if (region !== "ALL" && region !== "") p.region = region;
  if (gender !== "ALL" && gender !== "") p.gender = gender;

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

  return p;
}

/* ==========================
   Filter chips
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
    {k:"ภูมิภาค", v:getSelectText("regionSelect"), cls:"gray"},
    {k:"สาขา", v:getSelectText("branchSelect"), cls:"gray"},
    {k:"เพศ", v:getSelectText("genderSelect"), cls:"gray"},
    {k:"ปี", v:(ay === "ALL" ? "ทั้งหมด" : ay), cls:"gray"},
    {k:"ช่วงเวลา", v: cd ? `${rangeText()} (${cd})` : rangeText(), cls:"orange"},
  ];

  wrap.innerHTML = chips.map(c => `
    <div class="chip ${c.cls}">
      <span class="k">${c.k}:</span>
      <span class="v">${c.v}</span>
    </div>
  `).join("");
}

/* ==========================
   Charts
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
   Gender chart
   - gender != ALL => single bar
   - gender == ALL => use by_gender
========================== */
function setGenderChartNoData(msg){
  const box = $id("genderChartEmpty");
  const cv  = $id("chartGender");
  if (box) { box.textContent = msg || "ไม่พบข้อมูล"; box.style.display = "block"; }
  if (cv)  { cv.style.display = "none"; }
}
function setGenderChartShow(){
  const box = $id("genderChartEmpty");
  const cv  = $id("chartGender");
  if (box) box.style.display = "none";
  if (cv)  cv.style.display = "block";
}
function renderGenderChart(res){
  chartGender = destroyChart(chartGender);

  const gender = $id("genderSelect")?.value || "ALL";

  // ✅ เลือกเพศ => แสดงเฉพาะเพศนั้น (แท่งเดียว)
  if (gender !== "ALL" && gender !== "") {
    const total = Number(res?.kpi?.total_usage || 0);
    setGenderChartShow();
    chartGender = drawBar("chartGender", [gender], [total]);
    return;
  }

  // ✅ เลือกทั้งหมด => แสดงทุกเพศ (by_gender)
  const rows = Array.isArray(res?.by_gender) ? res.by_gender : [];
  if (!rows.length) {
    setGenderChartNoData("ไม่พบข้อมูลแยกตามเพศ");
    return;
  }

  setGenderChartShow();
  const labels = rows.map(r => r.gender || "-");
  const data   = rows.map(r => Number(r.count || 0));
  chartGender = drawBar("chartGender", labels, data);
}

/* ==========================
   UI render
========================== */
function setKPI(kpi){
  $id("kpiTotalUsage") && ($id("kpiTotalUsage").textContent = fmtNum(kpi.total_usage));
  $id("kpiTopFacultyName") && ($id("kpiTopFacultyName").textContent = kpi?.top_faculty?.name || "-");
  $id("kpiTopFacultyCount") && ($id("kpiTopFacultyCount").textContent = fmtNum(kpi?.top_faculty?.count || 0));

  const rate = Number(kpi.usage_rate || 0);
  $id("kpiUsageRate") && ($id("kpiUsageRate").textContent = rate.toFixed(1));
  $id("kpiUsageBar") && ($id("kpiUsageBar").style.width = Math.max(0, Math.min(100, rate)) + "%");
}

function renderTopEquipment(items){
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
   NEW: Member Tier Summary
========================== */
function renderMemberTier(rows){
  const tb = $id("memberTierTbody");
  if (!tb) return;

  rows = Array.isArray(rows) ? rows : [];

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.tier_name || r.member_tier || r.tier || "-"}</td>
      <td class="tr">${fmtNum(r.total_bookings ?? r.booking_count ?? r.count ?? 0)}</td>
      <td class="tr">${fmtNum(r.total_spent ?? r.total_amount ?? r.spend ?? r.net_amount ?? 0)} ฿</td>
    </tr>
  `).join("");
}

/* ==========================
   NEW: Student Coupon Top
========================== */
function renderStudentCouponTop(rows){
  const wrap = $id("studentCouponTop");
  if (!wrap) return;

  rows = Array.isArray(rows) ? rows : [];

  if (!rows.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</div>`;
    return;
  }

  const max = Math.max(...rows.map(x=>Number(x.count||0)), 1);

  wrap.innerHTML = rows.slice(0,5).map((it,i)=>{
    const code = it.coupon_code || it.code || it.coupon || "-";
    const c = Number(it.count || it.used_count || 0);
    const w = ((c*100)/max).toFixed(1);
    return `
      <div style="margin:10px 0;">
        <div class="row">
          <div style="font-weight:900;">#${i+1} ${code}</div>
          <div style="font-weight:900;">${fmtNum(c)} ครั้ง</div>
        </div>
        <div class="bar"><div style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

/* ==========================
   NEW: Payment Method Summary
========================== */
function renderPaymentMethod(rows){
  const tb = $id("paymentMethodTbody");
  if (!tb) return;

  rows = Array.isArray(rows) ? rows : [];

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.method_name || r.method || r.name || "-"}</td>
      <td class="tr">${fmtNum(r.tx_count ?? r.count ?? 0)}</td>
      <td class="tr">${fmtNum(r.net_amount ?? r.total ?? r.amount ?? 0)} ฿</td>
    </tr>
  `).join("");
}

/* ==========================
   Load meta (regions/branches)
========================== */
async function loadBranchRegionMeta(){
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

/* ==========================
   Load main API
========================== */
async function load(first){
  renderFilterChips();

  const res = await ExecCommon.apiGet(API_FILE, getParams());
  if (!res || !res.success) return;

  // meta ปี (จาก API users)
  if (first) {
    const sel = $id("academicYear");
    if (sel && Array.isArray(res?.meta?.academic_years)) {
      const years = res.meta.academic_years;
      sel.innerHTML = `<option value="ALL">ทั้งหมด</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
      if (years.length) sel.value = String(years[0]);
    }
  }

  setKPI(res.kpi || {});
  renderTopEquipment(res.top_equipment || []);

  // ✅ NEW sections
  renderMemberTier(res.member_tier_summary || res.member_tier || []);
  renderStudentCouponTop(res.student_coupon_top || res.student_coupon || []);
  renderPaymentMethod(res.payment_method_summary || res.payment_methods || []);

  chartFaculty = destroyChart(chartFaculty);
  chartStudyYear = destroyChart(chartStudyYear);
  chartPeak = destroyChart(chartPeak);

  // faculty chart
  const facRows = Array.isArray(res.by_faculty) ? res.by_faculty : [];
  chartFaculty = drawBar("chartFaculty", facRows.map(r=>r.faculty), facRows.map(r=>Number(r.count||0)));

  // study year chart
  const syRows = Array.isArray(res.by_study_year) ? res.by_study_year : [];
  chartStudyYear = drawBar("chartStudyYear", syRows.map(r=>"ปี "+r.study_year), syRows.map(r=>Number(r.count||0)));

  // ✅ gender chart
  renderGenderChart(res);

  // peak/daily
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