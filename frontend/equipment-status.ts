// equipment-status.ts (FIXED)
// - Remove stray header text that broke TS
// - Align params with API: get_equipment_instances.php expects "statuses" (comma list)

type MetaRes = {
  success: boolean;
  branches: { branch_id: string; name: string }[];
  equipment_statuses: { status: string }[];
};

type SumRes = { success: boolean; items: { status: string; qty: number }[] };

type ListRes = {
  success: boolean;
  items: {
    instance_code: string;
    name: string;
    category: string;
    location: string;
    status: string;
    received_date: string | null;
    expiry_date: string | null;
  }[];
};

function fillSelect(
  sel: HTMLSelectElement,
  items: { value: string; label: string }[],
  keepAll = true
) {
  const keep = sel.value;
  sel.innerHTML = keepAll ? `<option value="ALL">ทั้งหมด</option>` : "";
  items.forEach((it) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${String(it.value).replace(/"/g, "&quot;")}">${String(it.label).replace(/</g, "&lt;")}</option>`
    )
  );
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function getParams() {
  const branch_id =
    (document.getElementById("branchSelect") as HTMLSelectElement).value || "ALL";
  const status =
    (document.getElementById("statusSelect") as HTMLSelectElement).value || "ALL";
  const search = (document.getElementById("search") as HTMLInputElement).value.trim();

  const p: Record<string, string> = { branch_id };

  // ✅ API รองรับเป็น statuses (comma list)
  if (status && status !== "ALL") p.statuses = status;

  if (search) p.search = search;
  return p;
}

function renderSummary(rows: { status: string; qty: number }[]) {
  const tb = document.getElementById("sumTbody")!;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="2" style="color:#6b7280;">ไม่พบข้อมูล</td></tr>`;
    return;
  }
  tb.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.status || "-"}</td>
      <td style="text-align:right;">${(window as any).ExecCommon.num(r.qty || 0)}</td>
    </tr>
  `
    )
    .join("");
}

function renderList(rows: ListRes["items"]) {
  const tb = document.getElementById("listTbody")!;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" style="color:#6b7280;">ไม่พบข้อมูล</td></tr>`;
    return;
  }
  tb.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.instance_code}</td>
      <td>${r.name}</td>
      <td>${r.category}</td>
      <td>${r.status}</td>
      <td>${r.location || "-"}</td>
      <td>${r.expiry_date || "-"}</td>
    </tr>
  `
    )
    .join("");
}

async function loadMeta() {
  const meta: MetaRes = await (window as any).ExecCommon.apiGet("get_meta.php");
  if (!meta.success) return;

  fillSelect(
    document.getElementById("branchSelect") as HTMLSelectElement,
    meta.branches.map((b) => ({
      value: b.branch_id,
      label: `${b.branch_id} • ${b.name}`,
    })),
    true
  );

  fillSelect(
    document.getElementById("statusSelect") as HTMLSelectElement,
    meta.equipment_statuses.map((s) => ({ value: s.status, label: s.status })),
    true
  );
}

async function loadAll() {
  const p = getParams();

  // Summary: รองรับ branch_id (และ server จะคิดรวมทุกสถานะ)
  const sum: SumRes = await (window as any).ExecCommon.apiGet(
    "get_equipment_status_summary.php",
    { branch_id: p.branch_id }
  );
  if (sum.success) renderSummary(sum.items);

  // List
  const list: ListRes = await (window as any).ExecCommon.apiGet(
    "get_equipment_instances.php",
    p
  );
  if (list.success) renderList(list.items);
}

function bind() {
  document.getElementById("btnApply")!.addEventListener("click", loadAll);
  document.getElementById("btnReset")!.addEventListener("click", () =>
    location.reload()
  );
  document.getElementById("search")!.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") loadAll();
  });

  document.getElementById("btnPrint")!.addEventListener("click", (e) => {
    e.preventDefault();
    window.print();
  });

  // ถ้าต้องการให้ปุ่มออกจากระบบเรียก API logout จริง ๆ ให้เปลี่ยนเป็น ExecCommon.logout()
  document.getElementById("btnLogout")!.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "/sports_rental_system/executive/frontend/index.html";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await (window as any).ExecCommon.requireExecutive?.();
  if (ok === false) return;

  await loadMeta();
  bind();
  loadAll();
});