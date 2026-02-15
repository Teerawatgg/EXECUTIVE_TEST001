document.addEventListener("DOMContentLoaded", () => {
  renderHeader();
});

function renderHeader() {
  const header = document.createElement("header");
  header.className = "main-header";

  header.innerHTML = `
    <div class="header-top">
      <div class="brand">
        <span class="brand-name">ระบบเช่าอุปกรณ์กีฬา</span>
        <small>Sports Equipment Rental System</small>
      </div>

      <div class="staff-zone">
        <a href="profile.html" class="profile-btn">👤 โปรไฟล์</a>
      </div>
    </div>

    <div class="header-bottom">
      <nav class="main-nav">
        <a href="index.html" class="nav-item">เช่าอุปกรณ์</a>
        <a href="bookings.html" class="nav-item">รายการเช่า</a>
        <a href="return.html" class="nav-item">คืนอุปกรณ์</a>
        <a href="history_point.html" class="nav-item">สถานะอุปกรณ์</a>
      </nav>
    </div>
  `;

  document.body.prepend(header);
  setActiveMenu();
}

function setActiveMenu() {
  const links = document.querySelectorAll(".nav-item");
  const current = location.pathname.split("/").pop();

  links.forEach(link => {
    if (link.getAttribute("href") === current) {
      link.classList.add("active");
    }
  });
}