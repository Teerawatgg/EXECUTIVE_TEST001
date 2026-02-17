// equipment.ts (FIXED)
// - Align response shape with get_equipment_overview.php (executive/api)
// - Fix status filtering: keep radio bucket client-side (ไม่ต้องพึ่ง raw status จาก DB)

type Summary = {
  total: number;
  available: number;
  in_use: number;
  broken: number;
  maintenance: number;
};

type CatRow = {
  category_id: string;
  category_name: string;
  total: number;
};

type ApiItem = {
  code: string;
  name: string;
  status: string;
  received_date: string | null;
  expiry_date: string | null;
};

type ApiGroup = {
  category_id: string;
  category_name: string;
  total: number;
  items: ApiItem[];
};

type Res = {
  success: boolean;
  summary: Summary;
  categories: CatRow[];
  groups: ApiGroup[];
};

type UiBadge = "ok" | "use" | "bad" | "muted";

type UiItem = {
  code: string;
  name: string;
  status_raw: string;
  status_label: string;
  status_badge: UiBadge;
  received_date: string | null;
  expiry_date: string | null;
};

type UiGroup = { category: string; count: number; items: UiItem[] };

function $id(id: string) {
  return document.getElementById(id);
}

function fmtNum(n: any) {
  return Number(n || 0).toLocaleString("th-TH");
}

function fmtDateTH(d: any) {
  return d ? String(d) : "-";
}

function escHtml(s: any) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m] as string));
}

function getSelectedCategories(): string[] {
  const wrap = $id("catList");
  if (!wrap) return [];
  const arr: string[] = [];
  wrap
    .querySelectorAll<HTMLInputElement>("input[type='checkbox'][data-cat]")
    .forEach((ch) => {
      if (ch.checked) arr.push(ch.dataset.cat || "");
    });
  return arr.filter(Boolean);
}

// status radio เป็น "bucket" ฝั่ง UI (ALL/available/in_use/damaged)
function getSelectedStatusBucket(): "ALL" | "available" | "in_use" | "damaged" {
  const wrap = $id("statusList");
  if (!wrap) return "ALL";
  const el = wrap.querySelector<HTMLInputElement>("input[name='status']:checked");
  const v = (el ? el.value : "ALL") as any;
  if (v === "available" || v === "in_use" || v === "damaged") return v;
  return "ALL";
}

function getParams(): Record<string, string> {
  const search = ($id("search") as HTMLInputElement | null)?.value.trim() || "";
  const categories = getSelectedCategories().join(",");

  const p: Record<string, string> = {};
  if (search) p.search = search;
  if (categories) p.categories = categories;

  // ✅ ไม่ส่ง status ไปที่ API (เพราะ API filter เป็น raw status ซึ่งไม่ตรง bucket)
  // เราจะ filter ด้วย bucket ฝั่ง client แทน
  return p;
}

function setText(id: string, v: any) {
  const el = $id(id);
  if (el) el.textContent = String(v ?? "-");
}

function statusPillClass(badge: UiBadge) {
  if (badge === "ok") return "pill ok";
  if (badge === "use") return "pill use";
  if (badge === "bad") return "pill bad";
  return "pill muted";
}

function bucketFromRawStatus(raw: string): "available" | "in_use" | "damaged" | "other" {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "available";

  const has = (k: string) => s.includes(k);

  // in_use
  if (
    has("in_use") || has("in use") || has("borrow") || has("rent") || has("use") ||
    raw.includes("กำลังใช้งาน") || raw.includes("ใช้งาน") || raw.includes("ยืม") || raw.includes("จอง")
  ) return "in_use";

  // damaged (broken + maintenance + worn)
  if (
    has("broken") || has("damage") || has("defect") || has("repair") || has("maint") || has("worn") || has("degrad") ||
    raw.includes("ชำรุด") || raw.includes("เสีย") || raw.includes("พัง") || raw.includes("ซ่อม") || raw.includes("เสื่อม")
  ) return "damaged";

  // available
  if (
    has("ready") || has("available") || has("free") || has("idle") ||
    raw.includes("พร้อม") || raw.includes("ว่าง")
  ) return "available";

  return "other";
}

function uiStatus(raw: string): { label: string; badge: UiBadge; bucket: "available" | "in_use" | "damaged" | "other" } {
  const b = bucketFromRawStatus(raw);
  if (b === "available") return { label: "ว่าง", badge: "ok", bucket: b };
  if (b === "in_use") return { label: "กำลังใช้งาน", badge: "use", bucket: b };
  if (b === "damaged") return { label: "ชำรุด", badge: "bad", bucket: b };
  return { label: raw || "-", badge: "muted", bucket: b };
}

function renderStatusList(summary: Summary) {
  const wrap = $id("statusList");
  if (!wrap) return;

  // summary จาก API มี broken/maintenance แยก — ฝั่ง UI ใช้ "ชำรุด" เป็น broken+maintenance
  const damaged = Number(summary.broken || 0) + Number(summary.maintenance || 0);

  wrap.innerHTML = `
    <div class="checkRow">
      <label><input type="radio" name="status" value="ALL" checked> ทั้งหมด</label>
      <span class="badgeCount">${fmtNum(summary.total)}</span>
    </div>
    <div class="checkRow">
      <label><input type="radio" name="status" value="available"> ว่าง</label>
      <span class="badgeCount">${fmtNum(summary.available)}</span>
    </div>
    <div class="checkRow">
      <label><input type="radio" name="status" value="in_use"> กำลังใช้งาน</label>
      <span class="badgeCount">${fmtNum(summary.in_use)}</span>
    </div>
    <div class="checkRow">
      <label><input type="radio" name="status" value="damaged"> ชำรุด</label>
      <span class="badgeCount">${fmtNum(damaged)}</span>
    </div>
  `;
}

function renderCategoryList(categories: CatRow[]) {
  const wrap = $id("catList");
  if (!wrap) return;

  if (!categories?.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่มีข้อมูลหมวดหมู่</div>`;
    return;
  }

  wrap.innerHTML = categories
    .map((c) => {
      const label = c.category_name || c.category_id || "-";
      const val = c.category_id || label;
      return `
        <div class="checkRow">
          <label>
            <input type="checkbox" data-cat="${escHtml(val)}" checked>
            ${escHtml(label)}
          </label>
          <span class="badgeCount">${fmtNum(c.total)}</span>
        </div>
      `;
    })
    .join("");
}

function toUiGroups(apiGroups: ApiGroup[], bucket: "ALL" | "available" | "in_use" | "damaged"): UiGroup[] {
  const out: UiGroup[] = [];

  for (const g of apiGroups || []) {
    const title = g.category_name || g.category_id || "อื่นๆ";

    const items: UiItem[] = (g.items || []).map((it) => {
      const st = uiStatus(it.status || "");
      return {
        code: it.code,
        name: it.name,
        status_raw: it.status || "",
        status_label: st.label,
        status_badge: st.badge,
        received_date: it.received_date,
        expiry_date: it.expiry_date,
      };
    });

    const filtered =
      bucket === "ALL"
        ? items
        : items.filter((x) => bucketFromRawStatus(x.status_raw) === bucket);

    if (filtered.length === 0) continue;

    out.push({
      category: title,
      count: filtered.length,
      items: filtered,
    });
  }

  return out;
}

function renderGroups(groups: UiGroup[]) {
  const wrap = $id("groups");
  if (!wrap) return;

  if (!groups?.length) {
    wrap.innerHTML = `<div style="color:#6b7280;font-weight:800;">ไม่พบข้อมูล</div>`;
    return;
  }

  wrap.innerHTML = groups
    .map((g) => {
      const rows = (g.items || [])
        .map((it) => `
            <tr>
              <td>${escHtml(it.code || "-")}</td>
              <td>${escHtml(it.name || "-")}</td>
              <td><span class="${statusPillClass(it.status_badge)}">${escHtml(it.status_label || "-")}</span></td>
              <td class="tdR">-</td>
              <td>${escHtml(fmtDateTH(it.received_date))}</td>
              <td class="tdR">${escHtml(fmtDateTH(it.expiry_date))}</td>
            </tr>
          `)
        .join("");

      return `
        <div class="group">
          <div class="groupHead">
            <div class="name">${escHtml(g.category || "อื่นๆ")}</div>
            <div class="sub">${fmtNum(g.count || 0)} รายการ</div>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่ออุปกรณ์</th>
                <th>สถานะ</th>
                <th class="tdR">การใช้งาน</th>
                <th>วันที่รับ</th>
                <th class="tdR">วันหมดอายุ</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="6" style="color:#6b7280;">ไม่พบข้อมูล</td></tr>`}</tbody>
          </table>
        </div>
      `;
    })
    .join("");
}

let lastRes: Res | null = null;

function applyClientFilters() {
  if (!lastRes?.success) return;

  const bucket = getSelectedStatusBucket();
  const uiGroups = toUiGroups(lastRes.groups || [], bucket);
  renderGroups(uiGroups);
}

async function load(initial: boolean) {
  const res: Res = await (window as any).ExecCommon.apiGet("get_equipment_overview.php", getParams());
  if (!res || !res.success) {
    const wrap = $id("groups");
    if (wrap) wrap.innerHTML = `<div style="color:#b91c1c;font-weight:900;">โหลดไม่สำเร็จ</div>`;
    return;
  }

  lastRes = res;

  // cards
  setText("sumTotal", fmtNum(res.summary?.total || 0));
  setText("sumAvailable", fmtNum(res.summary?.available || 0));
  setText("sumInUse", fmtNum(res.summary?.in_use || 0));

  const damaged = Number(res.summary?.broken || 0) + Number(res.summary?.maintenance || 0);
  // รองรับทั้ง id เดิม (sumDamaged) และ id ใหม่ (sumBroken)
  setText("sumDamaged", fmtNum(damaged));
  setText("sumBroken", fmtNum(damaged));

  renderStatusList(res.summary);
  if (initial) renderCategoryList(res.categories);

  // render list ด้วย client-side bucket
  applyClientFilters();

  // bind change (re-render ไม่ต้องยิง api ซ้ำ)
  $id("statusList")?.querySelectorAll("input[name='status']").forEach((el) => {
    el.addEventListener("change", applyClientFilters);
  });

  // category change: ต้องโหลดใหม่ (เพราะส่งไป query)
  $id("catList")?.querySelectorAll("input[type='checkbox'][data-cat]").forEach((el) => {
    el.addEventListener("change", () => load(false));
  });
}

function bindUI() {
  $id("btnApply")?.addEventListener("click", () => load(false));
  $id("btnReset")?.addEventListener("click", () => location.reload());
  $id("search")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") load(false);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await (window as any).ExecCommon.requireExecutive();
  if (!ok) return;
  bindUI();
  load(true);
});