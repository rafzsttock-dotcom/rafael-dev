(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let appToken = localStorage.getItem("tgLoginAppToken") || "";
  let flowId = null;

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (appToken) headers.Authorization = "Bearer " + appToken;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Terjadi kesalahan");
    return data;
  }

  function showStep(step) {
    ["stepPhone", "stepCode", "stepPassword"].forEach((id) => {
      $(id).classList.toggle("hidden", id !== step);
    });
  }

  function setMsg(el, text, isError = true) {
    el.textContent = text || "";
    el.style.color = isError ? "var(--danger)" : "#4ade80";
  }

  async function loadSessions() {
    const box = $("sessions");
    box.innerHTML = "Memuat...";
    try {
      const { sessions } = await api("/api/sessions");
      if (!sessions.length) { box.innerHTML = '<p class="hint">Belum ada sesi tersimpan.</p>'; return; }
      box.innerHTML = "";
      for (const s of sessions) {
        const row = document.createElement("div");
        row.className = "sess-item";
        row.innerHTML = `
          <div class="meta"><b>${escapeHtml(s.label)}</b><span>${escapeHtml(s.maskedPhone)} · ${new Date(s.createdAt).toLocaleString()}</span></div>
          <div class="sess-actions">
            <button class="ghost" data-act="test" data-id="${s.id}">Test</button>
            <button class="danger" data-act="del" data-id="${s.id}">Hapus</button>
          </div>`;
        box.appendChild(row);
      }
    } catch (e) {
      box.innerHTML = `<p class="hint">Gagal memuat: ${escapeHtml(e.message)}</p>`;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  $("sessions").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "test") {
      btn.textContent = "...";
      try {
        const r = await api(`/api/sessions/${id}/test`, { method: "POST" });
        alert("OK — akun: " + (r.account.username ? "@" + r.account.username : r.account.firstName || r.account.id));
      } catch (err) {
        alert("Gagal: " + err.message);
      } finally {
        btn.textContent = "Test";
      }
    } else if (btn.dataset.act === "del") {
      if (!confirm("Hapus & logout sesi ini?")) return;
      try {
        await api(`/api/sessions/${id}`, { method: "DELETE" });
        loadSessions();
      } catch (err) {
        alert("Gagal: " + err.message);
      }
    }
  });

  $("gateBtn").addEventListener("click", async () => {
    const token = $("gateToken").value.trim();
    try {
      await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Token salah");
      });
      appToken = token;
      localStorage.setItem("tgLoginAppToken", token);
      $("gate").classList.add("hidden");
      $("app").classList.remove("hidden");
      showStep("stepPhone");
      loadSessions();
    } catch (e) {
      setMsg($("gateMsg"), e.message);
    }
  });

  $("sendCodeBtn").addEventListener("click", async () => {
    const phone = $("phone").value.trim();
    try {
      const r = await api("/api/auth/send-code", { method: "POST", body: JSON.stringify({ phone }) });
      flowId = r.flowId;
      setMsg($("authMsg"), "Kode terkirim" + (r.isCodeViaApp ? " lewat Telegram." : "."), false);
      showStep("stepCode");
    } catch (e) {
      setMsg($("authMsg"), e.message);
    }
  });

  $("submitCodeBtn").addEventListener("click", async () => {
    const code = $("code").value.trim();
    try {
      const r = await api("/api/auth/submit-code", { method: "POST", body: JSON.stringify({ flowId, code }) });
      if (r.status === "password_required") {
        setMsg($("authMsg"), "Akun ini butuh password 2FA.", false);
        showStep("stepPassword");
        return;
      }
      setMsg($("authMsg"), "Login berhasil, sesi tersimpan terenkripsi.", false);
      showStep("stepPhone");
      $("phone").value = ""; $("code").value = "";
      loadSessions();
    } catch (e) {
      setMsg($("authMsg"), e.message);
    }
  });

  $("submitPasswordBtn").addEventListener("click", async () => {
    const password = $("password").value;
    try {
      const r = await api("/api/auth/submit-password", { method: "POST", body: JSON.stringify({ flowId, password }) });
      setMsg($("authMsg"), "Login berhasil, sesi tersimpan terenkripsi.", false);
      showStep("stepPhone");
      $("phone").value = ""; $("code").value = ""; $("password").value = "";
      loadSessions();
    } catch (e) {
      setMsg($("authMsg"), e.message);
    }
  });

  // auto-unlock if token already remembered
  if (appToken) {
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: appToken }),
    }).then(async (r) => {
      if (r.ok) {
        $("gate").classList.add("hidden");
        $("app").classList.remove("hidden");
        showStep("stepPhone");
        loadSessions();
      }
    }).catch(() => {});
  }
})();
