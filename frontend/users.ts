type Customer = {
  customer_id: string;
  name: string;
  customer_type: string;
  faculty: string;
  study_year: number;
  phone: string;
  email: string;
  current_points: number;
  member_level: string;
};

type Res = { success:boolean; items: Customer[]; error?:string };

function getParams(): Record<string,string> {
  const search = (document.getElementById("search") as HTMLInputElement).value.trim();
  const customer_type = (document.getElementById("customerType") as HTMLSelectElement).value;
  const member_level = (document.getElementById("memberLevel") as HTMLSelectElement).value;

  const p: Record<string,string> = {};
  if (search) p.search = search;
  if (customer_type !== "ALL") p.customer_type = customer_type;
  if (member_level !== "ALL") p.member_level = member_level;
  return p;
}

function render(rows: Customer[]) {
  const tb = document.getElementById("tbody")!;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="8" style="color:#6b7280;">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${r.customer_id}</td>
      <td>${r.name || "-"}</td>
      <td>${r.customer_type || "-"}</td>
      <td>${r.faculty || "-"}</td>
      <td>${r.study_year ?? "-"}</td>
      <td>${r.phone || "-"}</td>
      <td>${(window as any).ExecCommon.num(r.current_points || 0)}</td>
      <td>${r.member_level || "-"}</td>
    </tr>
  `).join("");
}

async function load() {
  const res: Res = await (window as any).ExecCommon.apiGet("get_customer.php", getParams());
  if (!res.success) {
    document.getElementById("tbody")!.innerHTML = `<tr><td colspan="8" style="color:#b91c1c;">โหลดไม่สำเร็จ</td></tr>`;
    return;
  }
  render(res.items);
}

function bind() {
  document.getElementById("btnApply")!.addEventListener("click", load);
  document.getElementById("btnReset")!.addEventListener("click", () => location.reload());
  document.getElementById("search")!.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") load(); });

  document.getElementById("btnPrint")!.addEventListener("click", (e) => { e.preventDefault(); window.print(); });
  document.getElementById("btnLogout")!.addEventListener("click", (e) => { e.preventDefault(); window.location.href="/sports_rental_system/executive/frontend/index.html"; });
}

document.addEventListener("DOMContentLoaded", () => { bind(); load(); });