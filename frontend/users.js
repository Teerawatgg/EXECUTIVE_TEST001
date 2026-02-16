// users.js (BRANCH PRIMARY) - filters auto refresh, branch is main, region disabled when branch selected
function $id(id) { return document.getElementById(id); }
function fmtNum(n){ return Number(n||0).toLocaleString("th-TH"); }
function fmtMoney(n){ return Number(n||0).toLocaleString("th-TH") + " ฿"; }

// ✅ ปรับให้ตรงกับโปรเจกต์คุณ
const API_BASE = "/sports_rental_system/executive/api/";
const API_FILE  = "get_users_dashboard.php";
const META_FILE = "get_meta.php";

// charts
let chartFaculty = null;
let chartStudyYear = null;
let chartPeak = null;
let mode = "peak";

function destroyChart(ch){ try{ ch?.destroy(); }catch{} return null; }

// anti-spam load
let _loading = false;
let _token = 0;

/* =========================
   API (ไม่พึ่ง ExecCommon)
========================= */
async function apiGet(file, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = API_BASE + file + (qs ? "?" + qs : "");
  console.log("[users] GET:", url);
  const res = await fetch(url, { credentials: "include" });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { success:false, error:"Invalid JSON", raw:text }; }
}

async function requireExecutive(){
  const me = await apiGet("me.php", {});
  if (!me || me.success === false) {
    window.location.href = "login.html";
    return false;
  }
  return true;
}

/* =========================
   Helpers
========================= */
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

/* =========================
   ✅ Branch Primary UI
   - ถ้าเลือกสาขาแล้ว -> ปิดภูมิภาค + รีเซ็ตเป็น ALL
========================= */
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

/* =========================
   Custom date box
========================= */
function setupCustomDateBox(){
  const box = $id("customDateBox");
  if (!box) return;

  const sync = () => {
    box.style.display = (getRange()==="custom") ? "block" : "none";
  };

  document.querySelectorAll('input[name="range"]').forEach(r=>{
    r.addEventListener("change", sync);
  });
  sync();
}

/* =========================
   ✅ Params -> API
   - สาขาเป็นหลัก:
     ถ้าเลือกสาขา -> ส่ง branch_id อย่างเดียว (ไม่ส่ง region)
     ถ้า "ทั้งหมด" -> ค่อยส่ง region/region_id
========================= */
function getParams(){
  const p = {};

  const branchVal = ($id("branchSelect")?.value ?? "ALL").trim();
  const regionVal = ($id("regionSelect")?.value ?? "ALL").trim();
  const ayVal     = ($id("academicYear")?.value ?? "ALL").trim();

  // ✅ branch primary
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

  // optional radios (ถ้ามีในหน้า)
  const faculty = getRadioValue("faculty");
  const sy      = getRadioValue("studyYear");
  if (faculty !== "ALL") p.faculties = String(faculty);
  if (sy !== "ALL")      p.study_years = String(sy);

  console.log("[users] params:", p);
  return p;
}

/* =========================
   Chips
========================= */
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
  ];

  wrap.innerHTML = chips.map(c => `
    <div class="chip ${c.cls}">
      <span class="k">${c.k}:</span>
      <span class="v">${c.v}</span>
    </div>
  `).join("");
}

/* =========================
   Charts
========================= */
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

/* =========================
   Renderers (safe)
========================= */
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

  const rows = Array.isArray(res?.student_coupon_top) ? res.student_coupon_top : [];
  if (!rows.length) { wrap.innerHTML = `<div style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</div>`; return; }

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

function renderPaymentMethod(res){
  const tb = $id("paymentMethodTbody");
  if (!tb) return;

  const rows = Array.isArray(res?.payment_method_summary) ? res.payment_method_summary : [];
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.method_name || "-"}</td>
      <td class="tr">${fmtNum(r.tx_count ?? 0)}</td>
      <td class="tr">${fmtNum(r.net_amount ?? 0)} ฿</td>
    </tr>
  `).join("");
}

function renderReviews(res){
  const totalEl = $id("rvTotal");
  const avgEl   = $id("rvAvg");
  const tb      = $id("recentReviewTbody");
  if (!totalEl || !avgEl || !tb) return;

  const sum = res?.review_summary || {};
  totalEl.textContent = fmtNum(sum.total_reviews || 0);
  avgEl.textContent   = Number(sum.avg_rating || 0).toFixed(1);

  const rows = Array.isArray(res?.recent_reviews) ? res.recent_reviews : [];
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="3" style="color:#6b7280;font-weight:900;">ยังไม่มีรีวิว</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.review_date || "-"}</td>
      <td>${(r.review_text || "-")}</td>
      <td class="tr">${fmtNum(r.rating || 0)}</td>
    </tr>
  `).join("");
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

/* =========================
   Meta dropdowns
========================= */
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

  // หลังเติม meta แล้ว sync UI อีกครั้ง
  syncBranchPrimaryUI();
}

/* =========================
   Peak/daily toggle
========================= */
function setMode(next){
  mode = next;
  $id("btnDaily")?.classList.toggle("active", mode==="daily");
  $id("btnPeak")?.classList.toggle("active", mode==="peak");
}

/* =========================
   Load main
========================= */
async function load(first){
  const t = ++_token;
  if (_loading) return;
  _loading = true;

  try{
    renderFilterChips();

    const res = await apiGet(API_FILE, getParams());
    if (t !== _token) return;

    if (!res || !res.success) {
      console.log("[users] API error:", res);
      setKPI({});
      renderMemberTier({});
      renderStudentCouponTop({});
      renderPaymentMethod({});
      renderReviews({});
      renderTopEquipment([]);

      chartFaculty = destroyChart(chartFaculty);
      chartStudyYear = destroyChart(chartStudyYear);
      chartPeak = destroyChart(chartPeak);
      return;
    }

    // academic years (ครั้งแรก)
    if (first) {
      const years = Array.isArray(res?.meta?.academic_years) ? res.meta.academic_years : [];
      const sel = $id("academicYear");
      if (sel && years.length) {
        const keep = sel.value || "ALL";
        sel.innerHTML = `<option value="ALL">ทั้งหมด</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join("");
        sel.value = keep;
      }
    }

    setKPI(res.kpi || {});
    renderMemberTier(res);
    renderStudentCouponTop(res);
    renderPaymentMethod(res);
    renderReviews(res);
    renderTopEquipment(res.top_equipment || []);

    // charts
    chartFaculty = destroyChart(chartFaculty);
    chartStudyYear = destroyChart(chartStudyYear);
    chartPeak = destroyChart(chartPeak);

    const facRows = Array.isArray(res.by_faculty) ? res.by_faculty : [];
    chartFaculty = drawBar("chartFaculty",
      facRows.map(r=>r.faculty||"-"),
      facRows.map(r=>Number(r.count||0))
    );

    const syRows = Array.isArray(res.by_study_year) ? res.by_study_year : [];
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
  } finally {
    _loading = false;
  }
}

/* =========================
   Bind UI (auto load)
========================= */
function bindUI(){
  // ✅ สาขาเป็นหลัก
  $id("branchSelect")?.addEventListener("change", ()=>{
    syncBranchPrimaryUI();
    load(false);
  });

  // ภูมิภาค (ใช้ได้เมื่อ branch=ALL เท่านั้น)
  $id("regionSelect")?.addEventListener("change", ()=>load(false));

  // ปีการศึกษา
  $id("academicYear")?.addEventListener("change", ()=>load(false));

  // ช่วงเวลา
  document.querySelectorAll('input[name="range"]').forEach(r=>{
    r.addEventListener("change", ()=>load(false));
  });

  // custom date
  ["fromDate","toDate"].forEach(id=>{
    $id(id)?.addEventListener("change", ()=>load(false));
  });

  // optional radios
  document.addEventListener("change", (e)=>{
    const t = e.target;
    if (!t) return;
    if (t.name === "faculty" || t.name === "studyYear") load(false);
  });

  // toggle charts
  $id("btnDaily")?.addEventListener("click", ()=>{ setMode("daily"); load(false); });
  $id("btnPeak")?.addEventListener("click", ()=>{ setMode("peak"); load(false); });

  // optional buttons
  $id("btnApply")?.addEventListener("click", ()=>load(false));
  $id("btnReset")?.addEventListener("click", ()=>location.reload());
}

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", async ()=>{
  const ok = await requireExecutive();
  if (!ok) return;

  await loadMeta();
  setupCustomDateBox();
  bindUI();

  // sync UI ก่อนโหลดจริง
  syncBranchPrimaryUI();

  setMode("peak");
  await load(true);
});