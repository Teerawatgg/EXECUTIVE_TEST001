function $id(id) { return document.getElementById(id); }
function fmtNum(n){ return Number(n||0).toLocaleString("th-TH"); }

const API_BASE = "/sports_rental_system/executive/api/";
const API_FILE  = "get_users_dashboard.php";
const META_FILE = "get_meta.php";

let chartFaculty = null;
let chartStudyYear = null;
let chartPeak = null;
let mode = "peak";
let _token = 0;

function destroyChart(ch){ try{ ch?.destroy(); }catch{} return null; }

/* ✅ Robust JSON (กัน PHP ส่ง HTML / warning) */
async function apiGet(file, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = API_BASE + file + (qs ? "?" + qs : "");
  const res = await fetch(url, { credentials: "include" });
  const text = await res.text();

  // ถ้า server ส่ง HTML มา แปลว่า error
  if (/^\s*</.test(text) || text.includes("<br") || text.includes("<b>")) {
    return { success:false, error:"API returned HTML (server error)", raw:text.slice(0, 500), url };
  }
  try { return JSON.parse(text); }
  catch { return { success:false, error:"Invalid JSON", raw:text.slice(0, 500), url }; }
}

async function requireExecutive(){
  const me = await apiGet("me.php", {});
  if (!me || me.success === false) {
    window.location.href = "login.html";
    return false;
  }
  return true;
}

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

/* ============ Branch Primary ============ */
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

/* ============ Custom Date Box ============ */
function setupCustomDateBox(){
  const box = $id("customDateBox");
  if (!box) return;

  const sync = () => { box.style.display = (getRange()==="custom") ? "block" : "none"; };
  document.querySelectorAll('input[name="range"]').forEach(r => r.addEventListener("change", sync));
  sync();
}

/* ============ Params ============ */
function getParams(){
  const p = {};

  const branchVal = ($id("branchSelect")?.value ?? "ALL").trim();
  const regionVal = ($id("regionSelect")?.value ?? "ALL").trim();
  const ayVal     = ($id("academicYear")?.value ?? "ALL").trim();

  // Branch Primary
  if (branchVal !== "ALL" && branchVal !== "") {
    p.branch_id = branchVal;
  } else {
    if (regionVal !== "ALL" && regionVal !== "") {
      if (/^\d+$/.test(regionVal)) p.region_id = regionVal;
      else p.region = regionVal;
    }
  }

  if (ayVal !== "ALL" && ayVal !== "") p.academic_year = ayVal;

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

/* ============ Chips ============ */
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
    {k:"ปี", v:(ay === "ALL" ? "ทั้งหมด" : ay), cls:"gray"},
    {k:"ช่วงเวลา", v: cd ? `${rangeText()} (${cd})` : rangeText(), cls:"orange"},
    {k:"คณะ", v:(getRadioValue("faculty")==="ALL" ? "ทั้งหมด" : getRadioValue("faculty")), cls:"gray"},
    {k:"ชั้นปี", v:(getRadioValue("studyYear")==="ALL" ? "ทั้งหมด" : "ปี "+getRadioValue("studyYear")), cls:"gray"},
  ];

  wrap.innerHTML = chips.map(c => `
    <div class="chip ${c.cls}">
      <span class="k">${c.k}:</span>
      <span class="v">${c.v}</span>
    </div>
  `).join("");
}

/* ============ Charts ============ */
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

/* ============ KPI ============ */
function setKPI(kpi){
  $id("kpiTotalUsage") && ($id("kpiTotalUsage").textContent = fmtNum(kpi.total_usage || 0));
  $id("kpiTopFacultyName") && ($id("kpiTopFacultyName").textContent = kpi?.top_faculty?.name || "-");
  $id("kpiTopFacultyCount") && ($id("kpiTopFacultyCount").textContent = fmtNum(kpi?.top_faculty?.count || 0));

  const rate = Number(kpi.usage_rate || 0);
  $id("kpiUsageRate") && ($id("kpiUsageRate").textContent = rate.toFixed(1));
  $id("kpiUsageBar") && ($id("kpiUsageBar").style.width = Math.max(0, Math.min(100, rate)) + "%");
}

/* ============ Member tier ============ */
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

/* ============ ✅ Student coupon top (FIX) ============ */
function renderStudentCouponTop(res){
  const wrap = $id("studentCouponTop");
  if (!wrap) return;

  // ✅ รองรับทั้ง array ตรง ๆ และกรณีห่อเป็น object
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

/* ============ Payment method ============ */
function pickPaymentLabel(r){
  const raw =
    r?.method_name ??
    r?.method ??
    r?.channel_name ??
    r?.channel ??
    r?.payment_method_name ??
    r?.payment_method ??
    r?.method_code ??
    r?.code ??
    "";

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

/* ============ ✅ Equipment ratings (FIX ให้ตรง API) ============ */
function renderEquipmentRatings(res){
  const totalEl = $id("rvTotal");
  const avgEl   = $id("rvAvg");
  const tb      = $id("equipmentRatingTbody");
  if (!totalEl || !avgEl || !tb) return;

  // API ของคุณส่งมาเป็น object: equipment_ratings { total_reviews, avg_rating_overall, items[] }
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

/* ============ Top equipment ============ */
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

/* ============ Radio list renderer ============ */
function renderRadioList({wrapId, name, items, getValue, getLabel, getCount}){
  const wrap = $id(wrapId);
  if (!wrap) return;

  const safeItems = Array.isArray(items) ? items : [];
  const current = getRadioValue(name);

  const allCount = safeItems.reduce((s,it)=> s + Number(getCount?.(it) ?? 0), 0);
  const allChecked = (current === "ALL");

  const html = [];
  html.push(`
    <label class="item-radio">
      <input type="radio" name="${name}" value="ALL" ${allChecked ? "checked":""}/>
      <span>ทั้งหมด</span>
      <small>${fmtNum(allCount)} ครั้ง</small>
    </label>
  `);

  safeItems.forEach(it=>{
    const v = String(getValue(it));
    const checked = (current === v);
    html.push(`
      <label class="item-radio">
        <input type="radio" name="${name}" value="${v}" ${checked ? "checked":""}/>
        <span>${getLabel(it)}</span>
        <small>${fmtNum(getCount?.(it) ?? 0)} ครั้ง</small>
      </label>
    `);
  });

  wrap.innerHTML = html.join("");
}

/* ============ Meta dropdowns ============ */
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

/* ============ Mode ============ */
function setMode(next){
  mode = next;
  $id("btnDaily")?.classList.toggle("active", mode==="daily");
  $id("btnPeak")?.classList.toggle("active", mode==="peak");
}

/* ============ Load main ============ */
async function load(first){
  const t = ++_token;

  renderFilterChips();

  const res = await apiGet(API_FILE, getParams());
  if (t !== _token) return;

  if (!res || !res.success) {
    // ✅ แสดง error ให้ดีขึ้น (จะได้รู้ว่าเป็น 500/HTML/JSON พัง)
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

    $id("facultyList") && ($id("facultyList").innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูลคณะ</div>`);
    $id("studyYearList") && ($id("studyYearList").innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูลชั้นปี</div>`);
    return;
  }

  if (first) {
    const years = Array.isArray(res?.meta?.academic_years) ? res.meta.academic_years : [];
    const sel = $id("academicYear");
    if (sel && years.length) {
      const keep = sel.value || "ALL";
      sel.innerHTML = `<option value="ALL">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join("");
      sel.value = keep;
    }
  }

  const facRows = Array.isArray(res.by_faculty) ? res.by_faculty : [];
  renderRadioList({
    wrapId:"facultyList",
    name:"faculty",
    items: facRows,
    getValue: (it)=> it.faculty ?? "-",
    getLabel: (it)=> it.faculty ?? "-",
    getCount: (it)=> Number(it.count||0)
  });

  const syRows = Array.isArray(res.by_study_year) ? res.by_study_year : [];
  renderRadioList({
    wrapId:"studyYearList",
    name:"studyYear",
    items: syRows,
    getValue: (it)=> it.study_year ?? "-",
    getLabel: (it)=> "ปี " + (it.study_year ?? "-"),
    getCount: (it)=> Number(it.count||0)
  });

  setKPI(res.kpi || {});
  renderMemberTier(res);
  renderStudentCouponTop(res);
  renderPaymentMethod(res);
  renderEquipmentRatings(res);
  renderTopEquipment(res.top_equipment || []);

  chartFaculty = destroyChart(chartFaculty);
  chartStudyYear = destroyChart(chartStudyYear);
  chartPeak = destroyChart(chartPeak);

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

/* ============ Bind UI ============ */
function bindUI(){
  $id("branchSelect")?.addEventListener("change", ()=>{ syncBranchPrimaryUI(); load(false); });
  $id("regionSelect")?.addEventListener("change", ()=>load(false));
  $id("academicYear")?.addEventListener("change", ()=>load(false));

  document.querySelectorAll('input[name="range"]').forEach(r=>{
    r.addEventListener("change", ()=>load(false));
  });

  ["fromDate","toDate"].forEach(id=>{
    $id(id)?.addEventListener("change", ()=>load(false));
  });

  document.addEventListener("change", (e)=>{
    const t = e.target;
    if (!t) return;
    if (t.name === "faculty" || t.name === "studyYear") load(false);
  });

  $id("btnDaily")?.addEventListener("click", ()=>{ setMode("daily"); load(false); });
  $id("btnPeak")?.addEventListener("click", ()=>{ setMode("peak"); load(false); });

  $id("btnApply")?.addEventListener("click", ()=>load(false));

  $id("btnReset")?.addEventListener("click", ()=>{
    $id("branchSelect") && ($id("branchSelect").value = "ALL");
    $id("regionSelect") && ($id("regionSelect").value = "ALL");
    $id("academicYear") && ($id("academicYear").value = "ALL");

    document.querySelectorAll('input[name="range"]').forEach(r=>{ r.checked = (r.value === "all"); });

    $id("fromDate") && ($id("fromDate").value = "");
    $id("toDate") && ($id("toDate").value = "");

    const fAll = document.querySelector('input[name="faculty"][value="ALL"]');
    if (fAll) fAll.checked = true;
    const sAll = document.querySelector('input[name="studyYear"][value="ALL"]');
    if (sAll) sAll.checked = true;

    syncBranchPrimaryUI();
    setupCustomDateBox();
    load(false);
  });
}

/* ============ Init ============ */
document.addEventListener("DOMContentLoaded", async ()=>{
  const ok = await requireExecutive();
  if (!ok) return;

  await loadMeta();
  setupCustomDateBox();
  bindUI();
  syncBranchPrimaryUI();
  setMode("peak");
  await load(true);
});