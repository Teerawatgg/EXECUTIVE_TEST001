/* users.js (filters: userType + dropdown faculty/studyYear, disable when GENERAL) */

function $id(id) { return document.getElementById(id); }
function fmtNum(n){ return Number(n||0).toLocaleString("th-TH"); }

const API_BASE = "/sports_rental_system/executive/api/";
const API_FILE = "get_users_dashboard.php";
const META_FILE = "get_meta.php";

let chartFaculty = null;
let chartStudyYear = null;
let chartPeak = null;

let mode = "peak";
let _token = 0;

/* -------------------- helpers -------------------- */
function destroyChart(ch){ try{ ch?.destroy(); }catch{} return null; }

async function apiGet(file, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = API_BASE + file + (qs ? "?" + qs : "");
  const res = await fetch(url, { credentials: "include" });
  const text = await res.text();

  // กันกรณี PHP ส่ง warning/HTML ออกมา
  if (/^\s*</.test(text) || text.includes("<br") || text.includes("<b>")) {
    return { success:false, error:"API returned HTML (server error)", raw:text.slice(0, 600), url };
  }
  try { return JSON.parse(text); }
  catch { return { success:false, error:"Invalid JSON", raw:text.slice(0, 600), url }; }
}

async function requireExecutive(){
  const me = await apiGet("me.php", {});
  if (!me || me.success === false) {
    window.location.href = "login.html";
    return false;
  }
  return true;
}

function getRadioValue(name){
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "ALL";
}
function getRange(){ return getRadioValue("range") || "all"; }

function getSelectText(id){
  const el = $id(id);
  if (!el) return "ทั้งหมด";
  return el.options?.[el.selectedIndex]?.textContent?.trim() || "ทั้งหมด";
}

/* -------------------- userType: disable faculty/studyYear when GENERAL -------------------- */
function getUserType(){
  return getRadioValue("userType") || "ALL";
}
function syncUserTypeUI(){
  const type = getUserType();
  const fac = $id("facultySelect");
  const sy  = $id("studyYearSelect");
  if (!fac || !sy) return;

  if (type === "GENERAL") {
    fac.value = "ALL";
    sy.value = "ALL";
    fac.disabled = true;
    sy.disabled = true;
    fac.classList.add("disabled");
    sy.classList.add("disabled");
  } else {
    fac.disabled = false;
    sy.disabled = false;
    fac.classList.remove("disabled");
    sy.classList.remove("disabled");
  }
}

/* -------------------- Branch primary (สาขาเลือกแล้วปิดภูมิภาค) -------------------- */
function syncBranchPrimaryUI(){
  const bs = $id("branchSelect");
  const rs = $id("regionSelect");
  if (!bs || !rs) return;

  const branchVal = (bs.value || "ALL").trim();
  if (branchVal !== "ALL" && branchVal !== "") {
    rs.value = "ALL";
    rs.disabled = true;
    rs.classList.add("disabled");
  } else {
    rs.disabled = false;
    rs.classList.remove("disabled");
  }
}

/* -------------------- custom date box -------------------- */
function setupCustomDateBox(){
  const box = $id("customDateBox");
  if (!box) return;

  const sync = () => { box.style.display = (getRange()==="custom") ? "block" : "none"; };
  document.querySelectorAll('input[name="range"]').forEach(r => r.addEventListener("change", sync));
  sync();
}

/* -------------------- params -------------------- */
function getParams(){
  const p = {};

  const branchVal = ($id("branchSelect")?.value ?? "ALL").trim();
  const regionVal = ($id("regionSelect")?.value ?? "ALL").trim();

  // Branch primary
  if (branchVal !== "ALL" && branchVal !== "") {
    p.branch_id = branchVal;
  } else {
    if (regionVal !== "ALL" && regionVal !== "") {
      if (/^\d+$/.test(regionVal)) p.region_id = regionVal;
      else p.region = regionVal;
    }
  }

  // ✅ ประเภทผู้ใช้
  const userType = getUserType();
  if (userType !== "ALL") p.user_type = userType; // STUDENT | GENERAL

  // ✅ เพศ
  const gender = getRadioValue("gender");
  if (gender !== "ALL" && gender !== "") p.gender_id = String(gender);

  // ✅ คณะ/ชั้นปี (dropdown)
  const facVal = ($id("facultySelect")?.value ?? "ALL").trim();
  const syVal  = ($id("studyYearSelect")?.value ?? "ALL").trim();

  // ถ้าเป็น GENERAL จะถูก syncUserTypeUI บังคับเป็น ALL แล้ว
  if (facVal !== "ALL" && facVal !== "") p.faculty = facVal;
  if (syVal !== "ALL" && syVal !== "") p.study_year = syVal;

  // ช่วงเวลา
  const range = getRange();
  p.range = range;

  if (range === "custom") {
    const from = $id("fromDate")?.value || "";
    const to   = $id("toDate")?.value || "";
    if (from) p.from = from;
    if (to) p.to = to;
  }

  return p;
}

/* -------------------- chips -------------------- */
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
function userTypeText(){
  const t = getUserType();
  if (t === "STUDENT") return "นักศึกษา";
  if (t === "GENERAL") return "บุคคลทั่วไป";
  return "ทั้งหมด";
}
function genderText(){
  const g = getRadioValue("gender");
  return (g==="1"?"ชาย":(g==="2"?"หญิง":(g==="3"?"อื่นๆ":"ทั้งหมด")));
}
function renderFilterChips(){
  const wrap = $id("filterChips");
  if (!wrap) return;

  const cd = customDateText();

  const chips = [
    {k:"ประเภทผู้ใช้", v:userTypeText(), cls:"gray"},
    {k:"ภูมิภาค", v:getSelectText("regionSelect"), cls:"gray"},
    {k:"สาขา", v:getSelectText("branchSelect"), cls:"gray"},
    {k:"เพศ", v:genderText(), cls:"gray"},
    {k:"ช่วงเวลา", v: cd ? `${rangeText()} (${cd})` : rangeText(), cls:"orange"},
    {k:"คณะ", v:getSelectText("facultySelect"), cls:"gray"},
    {k:"ชั้นปี", v:getSelectText("studyYearSelect"), cls:"gray"},
  ];

  wrap.innerHTML = chips.map(c => `
    <div class="chip ${c.cls}">
      <span class="k">${c.k}:</span>
      <span class="v">${c.v}</span>
    </div>
  `).join("");
}

/* -------------------- charts -------------------- */
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
        x:{ grid:{ display:false }, ticks:{ maxRotation:0, autoSkip:true } },
        y:{ beginAtZero:true, ticks:{ precision:0 } }
      }
    }
  });
}

/* -------------------- render blocks -------------------- */
function setKPI(kpi){
  $id("kpiTotalUsage") && ($id("kpiTotalUsage").textContent = fmtNum(kpi.total_usage || 0));
  $id("kpiTopFacultyName") && ($id("kpiTopFacultyName").textContent = kpi?.top_faculty?.name || "-");
  $id("kpiTopFacultyCount") && ($id("kpiTopFacultyCount").textContent = fmtNum(kpi?.top_faculty?.count || 0));

  const rate = Number(kpi.usage_rate || 0);
  $id("kpiUsageRate") && ($id("kpiUsageRate").textContent = rate.toFixed(1));
  $id("kpiUsageBar") && ($id("kpiUsageBar").style.width = Math.max(0, Math.min(100, rate)) + "%");
}

function renderMemberTier(res){
  const tb = $id("memberTierTbody");
  if (!tb) return;

  const rows = Array.isArray(res?.member_tier_summary) ? res.member_tier_summary : [];
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.tier_name || "-"}</td>
      <td class="tr">${fmtNum(r.total_bookings ?? 0)}</td>
      <td class="tr">${fmtNum(r.total_spent ?? 0)} ฿</td>
    </tr>
  `).join("");
}

function renderStudentCouponTop(res){
  const wrap = $id("studentCouponTop");
  if (!wrap) return;

  let rows = [];
  if (Array.isArray(res?.student_coupon_top)) rows = res.student_coupon_top;
  else if (Array.isArray(res?.student_coupon_top?.items)) rows = res.student_coupon_top.items;

  if (!rows.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</div>`;
    return;
  }

  const max = Math.max(...rows.map(x=>Number(x.count||0)), 1);
  wrap.innerHTML = rows.slice(0,5).map((it,i)=>{
    const code = it.coupon_code || "-";
    const c = Number(it.count || 0);
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

function pickPaymentLabel(r){
  const raw = r?.method_name ?? r?.method ?? r?.channel_name ?? r?.channel ?? r?.payment_method_name ?? r?.payment_method ?? r?.method_code ?? r?.code ?? "";
  const v = String(raw).trim();
  if (!v || v === "-" || v.toLowerCase() === "null" || v.toLowerCase() === "undefined") {
    const code = String(r?.method_code || r?.code || "").toUpperCase().trim();
    if (code === "QR" || code === "QRCODE") return "ชำระเงินผ่าน QR Code";
    if (code === "CASH") return "เงินสด";
    if (code === "CARD") return "บัตรเครดิต/เดบิต";
    if (code) return code;
    return "ไม่ระบุช่องทาง";
  }
  const code2 = v.toUpperCase();
  if (code2 === "QR" || code2 === "QRCODE") return "ชำระเงินผ่าน QR Code";
  if (code2 === "CASH") return "เงินสด";
  if (code2 === "CARD") return "บัตรเครดิต/เดบิต";
  return v;
}
function pickPaymentCount(r){ return Number(r?.tx_count ?? r?.count ?? r?.total ?? 0); }
function pickPaymentAmount(r){ return Number(r?.net_amount ?? r?.amount ?? r?.total_amount ?? r?.sum_amount ?? 0); }

function renderPaymentMethod(res){
  const tb = $id("paymentMethodTbody");
  if (!tb) return;

  const rows = res?.payment_method_summary || res?.payment_summary || res?.payments || [];
  if (!Array.isArray(rows) || !rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${pickPaymentLabel(r)}</td>
      <td class="tr">${fmtNum(pickPaymentCount(r))}</td>
      <td class="tr">${fmtNum(pickPaymentAmount(r))} ฿</td>
    </tr>
  `).join("");
}

function renderEquipmentRatings(res){
  const totalEl = $id("rvTotal");
  const avgEl   = $id("rvAvg");
  const tb      = $id("equipmentRatingTbody");
  if (!totalEl || !avgEl || !tb) return;

  const pack = res?.equipment_ratings || null;

  const totalReviews = Number(pack?.total_reviews ?? 0);
  const avgOverall   = Number(pack?.avg_rating_overall ?? 0);

  totalEl.textContent = fmtNum(totalReviews);
  avgEl.textContent   = avgOverall.toFixed(1);

  const items = Array.isArray(pack?.items) ? pack.items : [];
  if (!items.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ยังไม่มีข้อมูลการให้คะแนนอุปกรณ์</td></tr>`;
    return;
  }

  const denom = totalReviews > 0 ? totalReviews : (items.reduce((s,r)=>s+Number(r.review_count||0),0) || 1);

  tb.innerHTML = items.slice(0,10).map(r=>{
    const name = r.equipment_name || "-";
    const avg  = Number(r.avg_rating ?? 0);
    const cnt  = Number(r.review_count ?? 0);
    const pct  = (cnt * 100) / denom;
    return `
      <tr>
        <td title="${name}">${name}</td>
        <td class="tr">${avg.toFixed(1)} <span style="color:#6b7280;">(${fmtNum(cnt)})</span></td>
        <td class="tr">${pct.toFixed(1)}%</td>
      </tr>
    `;
  }).join("");
}

function renderTopEquipment(items){
  const wrap = $id("topEquipmentList");
  if (!wrap) return;

  items = Array.isArray(items) ? items : [];
  if (!items.length) { wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</div>`; return; }

  const max = Math.max(...items.map(x=>Number(x.count||0)), 1);
  wrap.innerHTML = items.slice(0,5).map((it,i)=>{
    const w = ((Number(it.count||0)*100)/max).toFixed(1);
    return `
      <div style="margin:10px 0;">
        <div class="row">
          <div style="font-weight:900;">#${i+1} ${it.name || "-"}</div>
          <div style="font-weight:900;">${fmtNum(it.count||0)} ครั้ง</div>
        </div>
        <div class="bar"><div style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

/* -------------------- meta (regions/branches) -------------------- */
async function loadMeta(){
  const meta = await apiGet(META_FILE, {});
  if (!meta || !meta.success) return;

  const rs = $id("regionSelect");
  if (rs && Array.isArray(meta.regions)) {
    const keep = rs.value || "ALL";
    rs.innerHTML = `<option value="ALL">ทั้งหมด</option>` + meta.regions.map(r=>{
      const val = (r.region_id ?? r.region ?? r.region_name ?? r.name);
      const txt = (r.region ?? r.region_name ?? r.name ?? val);
      return `<option value="${val}">${txt}</option>`;
    }).join("");
    rs.value = keep;
  }

  const bs = $id("branchSelect");
  if (bs && Array.isArray(meta.branches)) {
    const keep = bs.value || "ALL";
    bs.innerHTML = `<option value="ALL">ทั้งหมด</option>` + meta.branches.map(b=>{
      return `<option value="${b.branch_id}">${b.branch_id} • ${b.name}</option>`;
    }).join("");
    bs.value = keep;
  }

  syncBranchPrimaryUI();
}

/* -------------------- mode -------------------- */
function setMode(next){
  mode = next;
  $id("btnDaily")?.classList.toggle("active", mode==="daily");
  $id("btnPeak")?.classList.toggle("active", mode==="peak");
}

/* -------------------- fill dropdowns from API meta -------------------- */
function fillFacultyDropdown(metaFac){
  const sel = $id("facultySelect");
  if (!sel) return;

  const keep = sel.value || "ALL";
  sel.innerHTML = `<option value="ALL">ทั้งหมด</option>`;

  (Array.isArray(metaFac) ? metaFac : []).forEach(f=>{
    const id = f.id ?? f.faculty_id ?? f.value ?? "";
    const name = f.name ?? f.faculty_name ?? f.label ?? "";
    if (id === "" || name === "") return;
    sel.insertAdjacentHTML("beforeend", `<option value="${id}">${name}</option>`);
  });

  sel.value = keep;
}

function fillStudyYearDropdown(metaSY){
  const sel = $id("studyYearSelect");
  if (!sel) return;

  const keep = sel.value || "ALL";
  sel.innerHTML = `<option value="ALL">ทั้งหมด</option>`;

  (Array.isArray(metaSY) ? metaSY : []).forEach(y=>{
    const yy = String(y ?? "").trim();
    if (!yy) return;
    sel.insertAdjacentHTML("beforeend", `<option value="${yy}">ปี ${yy}</option>`);
  });

  sel.value = keep;
}

/* -------------------- main load -------------------- */
async function load(first){
  const t = ++_token;

  renderFilterChips();

  const res = await apiGet(API_FILE, getParams());
  if (t !== _token) return;

  if (!res || !res.success) {
    console.warn("[users] API error:", res);

    setKPI({});
    renderMemberTier({});
    renderStudentCouponTop({});
    renderPaymentMethod({});
    renderEquipmentRatings({});
    renderTopEquipment([]);

    chartFaculty = destroyChart(chartFaculty);
    chartStudyYear = destroyChart(chartStudyYear);
    chartPeak = destroyChart(chartPeak);
    return;
  }

  // ✅ เติม dropdown ครั้งแรกจาก meta ของ API นี้
  if (first) {
    fillFacultyDropdown(res?.meta?.faculties || []);
    fillStudyYearDropdown(res?.meta?.study_years || []);
    syncUserTypeUI();
  }

  // KPI + tables
  setKPI(res.kpi || {});
  renderMemberTier(res);
  renderStudentCouponTop(res);
  renderPaymentMethod(res);
  renderEquipmentRatings(res);
  renderTopEquipment(res.top_equipment || []);

  // charts
  chartFaculty = destroyChart(chartFaculty);
  chartStudyYear = destroyChart(chartStudyYear);
  chartPeak = destroyChart(chartPeak);

  const facRows = Array.isArray(res.by_faculty) ? res.by_faculty : [];
  const syRows  = Array.isArray(res.by_study_year) ? res.by_study_year : [];

  chartFaculty = drawBar("chartFaculty",
    facRows.map(r=>r.faculty||"-"),
    facRows.map(r=>Number(r.count||0))
  );

  chartStudyYear = drawBar("chartStudyYear",
    syRows.map(r=>"ปี " + (r.study_year ?? "-")),
    syRows.map(r=>Number(r.count||0))
  );

  if (mode === "daily") {
    const labels = res.daily_usage?.labels || [];
    const data   = res.daily_usage?.counts || [];
    chartPeak = drawBar("chartPeak", labels, data.map(x=>Number(x||0)));
  } else {
    const pkRows = Array.isArray(res.peak_time) ? res.peak_time : [];
    chartPeak = drawBar("chartPeak",
      pkRows.map(r=>r.label||"-"),
      pkRows.map(r=>Number(r.count||0))
    );
  }

  renderFilterChips();
}

/* -------------------- bind UI -------------------- */
function bindUI(){
  $id("branchSelect")?.addEventListener("change", ()=>{ syncBranchPrimaryUI(); load(false); });
  $id("regionSelect")?.addEventListener("change", ()=>load(false));

  $id("facultySelect")?.addEventListener("change", ()=>load(false));
  $id("studyYearSelect")?.addEventListener("change", ()=>load(false));

  // เวลา
  document.querySelectorAll('input[name="range"]').forEach(r=>{
    r.addEventListener("change", ()=>load(false));
  });
  ["fromDate","toDate"].forEach(id=>{
    $id(id)?.addEventListener("change", ()=>load(false));
  });

  // radio: userType + gender
  document.addEventListener("change", (e)=>{
    const el = e.target;
    if (!el) return;

    if (el.name === "userType") {
      syncUserTypeUI();
      load(false);
    }
    if (el.name === "gender") {
      load(false);
    }
  });

  $id("btnDaily")?.addEventListener("click", ()=>{ setMode("daily"); load(false); });
  $id("btnPeak")?.addEventListener("click", ()=>{ setMode("peak"); load(false); });

  $id("btnApply")?.addEventListener("click", ()=>load(false));

  $id("btnReset")?.addEventListener("click", ()=>{
    // reset branch/region
    $id("branchSelect") && ($id("branchSelect").value = "ALL");
    $id("regionSelect") && ($id("regionSelect").value = "ALL");

    // reset userType
    const utAll = document.querySelector('input[name="userType"][value="ALL"]');
    if (utAll) utAll.checked = true;

    // reset gender
    const gAll = document.querySelector('input[name="gender"][value="ALL"]');
    if (gAll) gAll.checked = true;

    // reset range
    document.querySelectorAll('input[name="range"]').forEach(r=>{ r.checked = (r.value === "all"); });
    $id("fromDate") && ($id("fromDate").value = "");
    $id("toDate") && ($id("toDate").value = "");

    // reset dropdown
    $id("facultySelect") && ($id("facultySelect").value = "ALL");
    $id("studyYearSelect") && ($id("studyYearSelect").value = "ALL");

    syncBranchPrimaryUI();
    syncUserTypeUI();
    setupCustomDateBox();
    load(false);
  });
}

/* -------------------- init -------------------- */
document.addEventListener("DOMContentLoaded", async ()=>{
  const ok = await requireExecutive();
  if (!ok) return;

  await loadMeta();
  setupCustomDateBox();
  bindUI();
  syncBranchPrimaryUI();
  syncUserTypeUI();
  setMode("peak");
  await load(true);
});