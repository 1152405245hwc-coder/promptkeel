(() => {
  const csrf = document.querySelector('meta[name="forge-csrf"]')?.getAttribute("content") || "";

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null) continue;
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, String(v));
    }
    for (const child of Array.isArray(children) ? children : [children]) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  let toastTimer = null;
  function showToast(msg, tone = "ok") {
    document.querySelectorAll(".toast").forEach((n) => n.remove());
    const box = el("div", { className: `toast ${tone}`, role: "status", textContent: msg });
    document.body.appendChild(box);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.remove(), 4200);
  }

  function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      const backdrop = el("div", { className: "modal-backdrop", role: "dialog", "aria-modal": "true" });
      const close = (ok) => {
        backdrop.remove();
        resolve(ok);
      };
      const cancelBtn = el("button", { type: "button", className: "btn", textContent: "Cancel", onClick: () => close(false) });
      const okBtn = el("button", {
        type: "button",
        className: `btn ${danger ? "danger" : "primary"}`,
        textContent: confirmLabel,
        onClick: () => close(true),
      });
      const modal = el("div", { className: "modal" }, [
        el("h3", { textContent: title }),
        el("div", { className: "mbody", textContent: message }),
        el("div", { className: "mfoot" }, [cancelBtn, okBtn]),
      ]);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      okBtn.focus();
    });
  }

  async function api(url, method = "GET", body = null) {
    const headers = { accept: "application/json" };
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers["x-forge-csrf"] = csrf;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: method !== "GET" ? JSON.stringify(body || {}) : undefined,
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text || res.statusText }; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function mountWorkbench() {
    const root = document.getElementById("forge-workbench-root");
    if (!root) return;
    const controls = {
      profile: document.getElementById("wb-profile"),
      model: document.getElementById("wb-model"),
      persona: document.getElementById("wb-persona"),
      personaMode: document.getElementById("wb-persona-mode"),
      transform: document.getElementById("wb-transform"),
      mode: document.getElementById("wb-mode"),
      strategy: document.getElementById("wb-strategy"),
    };
    const promptOut = document.getElementById("wb-prompt-out");
    const metaOut = document.getElementById("wb-meta");
    const actionsOut = document.getElementById("wb-actions");
    const probeOut = document.getElementById("wb-probe-out");

    const params = () => ({
      profile: controls.profile?.value || "generic",
      model: controls.model?.value || "deepseek",
      persona: controls.persona?.value || "",
      personaMode: controls.personaMode?.value || "",
      transform: controls.transform?.value || "none",
      mode: controls.mode?.value || "",
      strategy: controls.strategy?.value || "none",
    });

    async function doCompile() {
      try {
        const res = await api("/api/compile", "POST", params());
        const plan = res.plan;
        if (metaOut) {
          metaOut.textContent = `planId ${plan.planId} · grade ${plan.delivery.grade} · ${plan.prompt.tokens}/${plan.budget.max} tokens · actions ${plan.actions.length}`;
        }
        if (promptOut) promptOut.textContent = plan.prompt.text;
        if (actionsOut) {
          actionsOut.replaceChildren();
          const changeByPath = new Map((res.preview?.changes || []).map((c) => [c.path, c]));
          for (const a of plan.actions) {
            const c = a.path ? changeByPath.get(a.path) : null;
            const statusText = !c ? (a.op === "dsh-patches" ? "host-patch" : "virtual") : !c.existed ? "create" : c.changed ? "modify" : "unchanged";
            actionsOut.appendChild(el("tr", {}, [
              el("td", { className: "mono", textContent: a.op }),
              el("td", { className: "mono", textContent: a.kind }),
              el("td", { className: "mono", textContent: statusText }),
              el("td", { className: "mono", textContent: a.path || "(host patch table)" }),
            ]));
          }
        }
        return res;
      } catch (err) {
        showToast(err.message, "bad");
        return null;
      }
    }

    document.getElementById("wb-compile-btn")?.addEventListener("click", doCompile);
    document.getElementById("wb-copy-btn")?.addEventListener("click", async () => {
      const text = promptOut?.textContent || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast("Copied compiled prompt to clipboard", "ok");
      } catch {
        showToast("Clipboard unavailable; select prompt block directly", "bad");
      }
    });
    document.getElementById("wb-probe-btn")?.addEventListener("click", async () => {
      try {
        const res = await api("/api/probe", "POST", params());
        if (probeOut) probeOut.textContent = `score ${res.result.score} (${res.result.passed}/${res.result.total}) · self-check ${res.selfCheck.ok ? "ok" : "miss"}`;
        showToast(`Probe ${res.result.passed}/${res.result.total} passed`, res.result.failed ? "bad" : "ok");
      } catch (err) {
        showToast(err.message, "bad");
      }
    });
    document.getElementById("wb-apply-btn")?.addEventListener("click", async () => {
      const compiled = await doCompile();
      if (!compiled) return;
      const ok = await confirmDialog({
        title: "Apply compiled plan to workspace?",
        message: `Profile ${compiled.plan.profile.id} (${compiled.plan.delivery.grade}) will write ${compiled.preview?.changes?.length ?? 0} file change(s) and record a reversible backup manifest.`,
        confirmLabel: "Apply Plan",
      });
      if (!ok) return;
      try {
        const res = await api("/api/apply-plan", "POST", { ...params(), preview: compiled.preview.preview, confirm: true });
        showToast(res.ok ? `Applied plan ${res.id}` : (res.error || "apply failed"), res.ok ? "ok" : "bad");
      } catch (err) {
        showToast(err.message, "bad");
      }
    });
    document.getElementById("wb-snapshot-btn")?.addEventListener("click", async () => {
      try {
        const res = await api("/api/snapshot", "POST", params());
        showToast(`Saved snapshot (${res.written?.bytes ?? 0} bytes)`, "ok");
      } catch (err) {
        showToast(err.message, "bad");
      }
    });
    for (const node of Object.values(controls)) node?.addEventListener("change", doCompile);
    doCompile();
  }

  function mountLiveRunner() {
    const root = document.getElementById("forge-live-root");
    if (!root) return;
    const gwInput = document.getElementById("live-gateway");
    const modelSel = document.getElementById("live-model");
    const profileSel = document.getElementById("live-profile");
    const personaSel = document.getElementById("live-persona");
    const strategySel = document.getElementById("live-strategy");
    const maxTokInput = document.getElementById("live-max-tokens");
    const promptInput = document.getElementById("live-prompt");
    const statusOut = document.getElementById("live-status");
    const replyOut = document.getElementById("live-reply");

    document.getElementById("live-fetch-models")?.addEventListener("click", async () => {
      try {
        const res = await api("/api/gateway/models", "POST", { gateway: gwInput?.value || "default" });
        if (modelSel && Array.isArray(res.models) && res.models.length) {
          modelSel.replaceChildren(...res.models.map((id) => el("option", { value: id, textContent: id })));
          showToast(`Loaded ${res.models.length} models from gateway`, "ok");
        }
      } catch (err) {
        showToast(err.message, "bad");
      }
    });

    document.getElementById("live-send-btn")?.addEventListener("click", async () => {
      if (statusOut) statusOut.textContent = "sending…";
      if (replyOut) replyOut.textContent = "";
      try {
        const res = await api("/api/live-run", "POST", {
          gateway: gwInput?.value || "default",
          model: modelSel?.value || "glm-5.3-flash",
          profile: profileSel?.value || "generic",
          persona: personaSel?.value || "",
          strategy: strategySel?.value || "none",
          maxTokens: Number(maxTokInput?.value || 512),
          rawUser: promptInput?.value || "",
        });
        if (statusOut) {
          const tok = res.usage && (res.usage.prompt !== null || res.usage.completion !== null)
            ? ` · ${res.usage.prompt ?? "?"}/${res.usage.completion ?? "?"} tok`
            : "";
          statusOut.textContent = `${res.verdict} · ${res.compliance || "-"} · ${res.latencyMs ?? 0}ms · turns ${res.turns ?? 1}${tok}${res.refusalSignal ? ` · signal ${res.refusalSignal}` : ""}`;
        }
        if (replyOut) replyOut.textContent = res.reply || res.error || "(empty)";
        showToast(`Result: ${res.verdict}`, res.status === "ok" && !res.refused ? "ok" : "bad");
      } catch (err) {
        if (statusOut) statusOut.textContent = err.message;
        showToast(err.message, "bad");
      }
    });
  }

  function mountPlanActions() {
    document.querySelectorAll("[data-plan-verify]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const id = btn.getAttribute("data-plan-verify");
          const res = await api("/api/verify-plan", "POST", { planId: id });
          showToast(`Plan ${id}: ${res.ok ? "verified" : res.status}`, res.ok ? "ok" : "bad");
        } catch (err) {
          showToast(err.message, "bad");
        }
      });
    });
    document.querySelectorAll("[data-plan-revert]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-plan-revert");
        const ok = await confirmDialog({
          title: `Revert plan ${id}?`,
          message: "All files modified by this plan will be restored byte-for-byte from backup.",
          confirmLabel: "Revert Plan",
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api("/api/revert-plan", "POST", { planId: id });
          showToast(res.ok ? `Reverted plan ${id}` : (res.error || "revert failed"), res.ok ? "ok" : "bad");
          if (res.ok) location.reload();
        } catch (err) {
          showToast(err.message, "bad");
        }
      });
    });
  }

  function mountPatchActions() {
    const filter = document.getElementById("patch-layer-filter");
    if (filter) {
      filter.addEventListener("change", () => {
        const val = filter.value;
        document.querySelectorAll("tbody tr[data-layer]").forEach((row) => {
          row.style.display = !val || val === "all" || row.getAttribute("data-layer") === val ? "" : "none";
        });
      });
    }
    const runDsh = async (op, label, danger = false) => {
      const ok = await confirmDialog({
        title: `${label}?`,
        message: `Execute DSH host action "${op}" against configured hostRoot/dshHome.`,
        confirmLabel: label,
        danger,
      });
      if (!ok) return;
      try {
        const res = await api(`/api/patches/${op}`, "POST", { confirm: true });
        showToast(res.ok ? `${label} ok` : (res.reason || res.error || "failed"), res.ok ? "ok" : "bad");
        if (res.ok) location.reload();
      } catch (err) {
        showToast(err.message, "bad");
      }
    };
    document.getElementById("dsh-dry-run")?.addEventListener("click", async () => {
      try {
        const res = await api("/api/patches/dry-run", "POST", {});
        showToast(`Dry-run: ${res.patches?.filter((p) => p.status === "hit").length || 0}/${res.patches?.length || 0} hit`, res.ok ? "ok" : "bad");
      } catch (err) {
        showToast(err.message, "bad");
      }
    });
    document.getElementById("dsh-apply")?.addEventListener("click", () => runDsh("apply", "Apply DSH Patches"));
    document.getElementById("dsh-upgrade")?.addEventListener("click", () => runDsh("upgrade", "Upgrade DSH Patches"));
    document.getElementById("dsh-revert")?.addEventListener("click", () => runDsh("revert", "Revert DSH Patches", true));
  }

  mountWorkbench();
  mountLiveRunner();
  mountPlanActions();
  mountPatchActions();
})();
