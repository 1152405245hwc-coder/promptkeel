const React = require("react");
const h = React.createElement;
const { useState, useEffect, useCallback } = React;

const NS = "dsh-forge";
const TABS = [
  { id: "overview", label: "总览" },
  { id: "patches", label: "补丁" },
  { id: "prompt", label: "提示词" },
  { id: "policy", label: "策略" },
  { id: "logs", label: "日志" },
];

function api(path, options) {
  return fetch("/dsh-forge/api" + path, {
    headers: { "content-type": "application/json" },
    ...options,
  }).then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  });
}

const css = `
.df-root{--df-bg:#0d1014;--df-panel:#141920;--df-panel2:#1a212a;--df-line:#26303b;--df-text:#e6edf3;--df-dim:#8b98a5;--df-amber:#f0b35b;--df-green:#5fd39b;--df-red:#ef6b73;--df-blue:#6cb6ff;
position:absolute;inset:0;display:flex;flex-direction:column;background:var(--df-bg);color:var(--df-text);font-family:"SF Pro Text","PingFang SC",system-ui,sans-serif;font-size:13px;overflow:hidden}
.df-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--df-line);background:linear-gradient(180deg,#151b22,#10151b)}
.df-logo{font:700 15px/1 "SF Mono",ui-monospace,monospace;letter-spacing:.12em;color:var(--df-amber)}
.df-pill{padding:3px 9px;border-radius:999px;font-size:11px;border:1px solid var(--df-line);color:var(--df-dim)}
.df-pill.ok{color:var(--df-green);border-color:rgba(95,211,155,.35);background:rgba(95,211,155,.08)}
.df-pill.bad{color:var(--df-red);border-color:rgba(239,107,115,.35);background:rgba(239,107,115,.08)}
.df-tabs{display:flex;gap:2px;padding:0 14px;border-bottom:1px solid var(--df-line);background:#11161c}
.df-tab{padding:10px 14px;color:var(--df-dim);cursor:pointer;border-bottom:2px solid transparent;background:none;border-top:0;border-left:0;border-right:0;font:inherit}
.df-tab:hover{color:var(--df-text)}
.df-tab.on{color:var(--df-amber);border-bottom-color:var(--df-amber)}
.df-body{flex:1;overflow:auto;padding:18px 20px}
.df-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}
.df-card{background:var(--df-panel);border:1px solid var(--df-line);border-radius:10px;padding:12px 14px}
.df-card .k{font-size:11px;color:var(--df-dim);margin-bottom:6px}
.df-card .v{font:600 20px/1.1 "SF Mono",ui-monospace,monospace}
.df-sec{background:var(--df-panel);border:1px solid var(--df-line);border-radius:10px;margin-bottom:14px;overflow:hidden}
.df-sec h3{margin:0;padding:10px 14px;font-size:12px;letter-spacing:.08em;color:var(--df-dim);border-bottom:1px solid var(--df-line);background:var(--df-panel2);font-weight:600}
.df-row{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid rgba(38,48,59,.55)}
.df-row:last-child{border-bottom:0}
.df-dot{width:7px;height:7px;border-radius:50%;flex:none}
.df-dot.ok{background:var(--df-green)}.df-dot.warn{background:var(--df-amber)}.df-dot.fail{background:var(--df-red)}
.df-name{width:180px;flex:none;color:var(--df-text)}
.df-detail{color:var(--df-dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.df-btn{padding:6px 12px;border-radius:7px;border:1px solid var(--df-line);background:var(--df-panel2);color:var(--df-text);cursor:pointer;font:inherit}
.df-btn:hover{border-color:var(--df-amber);color:var(--df-amber)}
.df-btn.primary{border-color:rgba(240,179,91,.5);background:rgba(240,179,91,.12);color:var(--df-amber)}
.df-btn.danger{border-color:rgba(239,107,115,.4);color:var(--df-red)}
.df-btn:disabled{opacity:.45;cursor:default}
.df-toolbar{display:flex;gap:8px;margin-bottom:12px;align-items:center}
.df-spacer{flex:1}
.df-table{width:100%;border-collapse:collapse}
.df-table th{text-align:left;font-size:11px;color:var(--df-dim);padding:8px 14px;border-bottom:1px solid var(--df-line);font-weight:600}
.df-table td{padding:9px 14px;border-bottom:1px solid rgba(38,48,59,.55);vertical-align:middle}
.df-table tr:last-child td{border-bottom:0}
.df-mono{font-family:"SF Mono",ui-monospace,monospace;font-size:12px}
.df-badge{display:inline-block;padding:2px 7px;border-radius:5px;font-size:11px;border:1px solid var(--df-line);color:var(--df-dim)}
.df-badge.applied{color:var(--df-green);border-color:rgba(95,211,155,.35)}
.df-badge.hit{color:var(--df-blue);border-color:rgba(108,182,255,.35)}
.df-badge.miss,.df-badge.missing,.df-badge.partial,.df-badge.ambiguous{color:var(--df-red);border-color:rgba(239,107,115,.35)}
.df-pre{margin:0;padding:14px;background:#0a0e12;border-radius:0;max-height:420px;overflow:auto;font:12px/1.55 "SF Mono",ui-monospace,monospace;color:#c8d3de;white-space:pre-wrap}
.df-policy{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.df-opt{padding:14px;border:1px solid var(--df-line);border-radius:10px;cursor:pointer;background:var(--df-panel)}
.df-opt.on{border-color:var(--df-amber);background:rgba(240,179,91,.06)}
.df-opt b{display:block;margin-bottom:6px}
.df-opt span{color:var(--df-dim);font-size:12px;line-height:1.5}
.df-empty{padding:36px;text-align:center;color:var(--df-dim)}
.df-err{padding:10px 14px;border:1px solid rgba(239,107,115,.4);background:rgba(239,107,115,.08);color:var(--df-red);border-radius:8px;margin-bottom:12px}
.df-log{padding:7px 14px;border-bottom:1px solid rgba(38,48,59,.45);font:12px/1.5 "SF Mono",ui-monospace,monospace;color:#b9c6d2}
.df-log time{color:var(--df-dim);margin-right:10px}
`;

function useForge() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(() => {
    api("/status").then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e.message || e)));
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  return { data, error, refresh };
}

function Shell() {
  const [tab, setTab] = useState("overview");
  const { data, error, refresh } = useForge();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [logs, setLogs] = useState([]);

  const run = async (name, fn) => {
    setBusy(name); setNotice(null);
    try { const r = await fn(); if (r && r.ok === false) throw new Error(r.message || r.reason || "操作失败"); setNotice({ ok: true, text: r && r.message ? r.message : "完成" }); refresh(); }
    catch (e) { setNotice({ ok: false, text: String(e.message || e) }); }
    finally { setBusy(null); }
  };

  const doctor = data && data.doctor;
  const okCount = doctor ? doctor.checks.filter((c) => c.status === "ok").length : 0;

  return h("div", { className: "df-root" },
    h("style", null, css),
    h("header", { className: "df-head" },
      h("div", { className: "df-logo" }, "DSH FORGE"),
      h("span", { className: "df-pill " + (doctor && doctor.ok ? "ok" : "bad") }, doctor ? (doctor.ok ? "PASS" : "FAIL") : "…"),
      h("span", { className: "df-pill" }, "DSH " + (data ? data.doctor.version : "…")),
      h("div", { className: "df-spacer" }),
      h("button", { className: "df-btn", onClick: refresh, disabled: !!busy }, "刷新")
    ),
    h("nav", { className: "df-tabs" }, TABS.map((t) => h("button", { key: t.id, className: "df-tab" + (tab === t.id ? " on" : ""), onClick: () => setTab(t.id) }, t.label))),
    h("div", { className: "df-body" },
      error ? h("div", { className: "df-err" }, error) : null,
      notice ? h("div", { className: "df-err", style: notice.ok ? { color: "var(--df-green)", borderColor: "rgba(95,211,155,.35)", background: "rgba(95,211,155,.07)" } : null }, notice.text) : null,
      tab === "overview" ? h(Overview, { data, okCount }) : null,
      tab === "patches" ? h(Patches, { data, busy, run }) : null,
      tab === "prompt" ? h(PromptView, { prompt, setPrompt, busy, run }) : null,
      tab === "policy" ? h(PolicyView, { data, busy, run }) : null,
      tab === "logs" ? h(LogView, { logs, setLogs, busy, run }) : null
    )
  );
}

function Overview({ data, okCount }) {
  if (!data) return h("div", { className: "df-empty" }, "读取状态…");
  const d = data.doctor;
  const patchCheck = d.checks.find((c) => c.id === "patches");
  const tokenCheck = d.checks.find((c) => c.id === "prompt-budget");
  const activation = d.activation || {};
  return h("div", null,
    h("div", { className: "df-cards" },
      h(Card, { k: "宿主版本", v: d.version }),
      h(Card, { k: "补丁", v: patchCheck ? patchCheck.detail.split(" ")[0] : "—" }),
      h(Card, { k: "提示词预算", v: tokenCheck ? tokenCheck.detail.split("/")[0] : "—" }),
      h(Card, { k: "策略", v: data.policy }),
      h(Card, { k: "生效状态", v: activation.state || "—" }),
    ),
    h("section", { className: "df-sec" },
      h("h3", null, "生效证据"),
      h("div", { className: "df-row" }, h("span", { className: "df-name" }, "配置"), h("span", { className: "df-detail" }, activation.configured ? "已配置" : "未配置")),
      h("div", { className: "df-row" }, h("span", { className: "df-name" }, "宿主"), h("span", { className: "df-detail" }, activation.hostReady ? "已就绪" : "待应用")),
      h("div", { className: "df-row" }, h("span", { className: "df-name" }, "会话"), h("span", { className: "df-detail" }, activation.sessionLoaded ? "已加载" : "需新建会话")),
      h("div", { className: "df-row" }, h("span", { className: "df-name" }, "风险"), h("span", { className: "df-detail" }, activation.risk || "未记录")),
    ),
    h("section", { className: "df-sec" },
      h("h3", null, "体检 · " + okCount + "/" + d.checks.length + " 通过"),
      d.checks.map((c) => h("div", { className: "df-row", key: c.id },
        h("i", { className: "df-dot " + c.status }),
        h("span", { className: "df-name" }, c.label),
        h("span", { className: "df-detail" }, c.detail)
      ))
    )
  );
}

function Card({ k, v }) {
  return h("div", { className: "df-card" }, h("div", { className: "k" }, k), h("div", { className: "v" }, String(v)));
}

function Patches({ data, busy, run }) {
  const rows = (data && data.doctor && data.doctor.patches) || [];
  return h("div", null,
    h("div", { className: "df-toolbar" },
      h("button", { className: "df-btn", disabled: !!busy, onClick: () => run("dry", () => api("/apply", { method: "POST", body: JSON.stringify({ dryRun: true }) })) }, busy === "dry" ? "预检中…" : "预检"),
      h("button", { className: "df-btn primary", disabled: !!busy, onClick: () => run("apply", () => api("/apply", { method: "POST", body: JSON.stringify({ dryRun: false }) })) }, busy === "apply" ? "应用中…" : "应用全部"),
      h("button", { className: "df-btn", disabled: !!busy, onClick: () => run("upgrade", () => api("/upgrade", { method: "POST", body: JSON.stringify({ dryRun: false }) })) }, busy === "upgrade" ? "更新中…" : "刷新补丁"),
      h("button", { className: "df-btn danger", disabled: !!busy, onClick: () => { if (confirm("从最近备份回滚全部补丁？")) run("revert", () => api("/revert", { method: "POST", body: "{}" })); } }, busy === "revert" ? "回滚中…" : "回滚"),
      h("div", { className: "df-spacer" }),
      h("span", { className: "df-pill" }, rows.length + " 条")
    ),
    h("section", { className: "df-sec" },
      h("table", { className: "df-table" },
        h("thead", null, h("tr", null, ["ID", "标题", "状态", "文件", "命中"].map((x) => h("th", { key: x }, x)))),
        h("tbody", null, rows.length === 0 ? h("tr", null, h("td", { colSpan: 5, className: "df-empty" }, "没有补丁数据")) : rows.map((p) => h("tr", { key: p.id },
          h("td", { className: "df-mono" }, p.id),
          h("td", null, p.title || ""),
          h("td", null, h("span", { className: "df-badge " + p.status }, p.status)),
          h("td", { className: "df-mono" }, p.file || (p.files && p.files[0] && p.files[0].abs ? p.files[0].abs.split("/").slice(-2).join("/") : "")),
          h("td", { className: "df-mono" }, String(p.matches != null ? p.matches : (p.files ? p.files.reduce((n, f) => n + (f.matches || 0), 0) : "")))
        )))
      )
    )
  );
}

function PromptView({ prompt, setPrompt, busy, run }) {
  useEffect(() => { if (!prompt) api("/prompt").then((d) => setPrompt(d)).catch(() => {}); }, [prompt, setPrompt]);
  return h("div", null,
    h("div", { className: "df-toolbar" },
      h("button", { className: "df-btn", disabled: !!busy, onClick: () => run("regen", () => api("/prompt").then((d) => { setPrompt(d); return d; })) }, busy === "regen" ? "生成中…" : "重新生成"),
      h("span", { className: "df-pill" }, prompt ? prompt.tokens + " tokens / 3200" : "…"),
      h("div", { className: "df-spacer" }),
      h("button", { className: "df-btn primary", disabled: !!busy || !prompt, onClick: () => run("install", () => api("/prompt/install", { method: "POST", body: "{}" })) }, busy === "install" ? "写入中…" : "安装到 prompt-inject")
    ),
    h("section", { className: "df-sec" },
      h("h3", null, "组合预览 · " + (prompt ? prompt.sha256.slice(0, 12) : "")),
      h("pre", { className: "df-pre" }, prompt ? prompt.text : "生成中…")
    )
  );
}

function PolicyView({ data, busy, run }) {
  const current = data ? data.policy : "fallback";
  const options = [
    ["strict", "严格接管", "始终由 Forge 接管 workspace 提示词基线，忽略宿主默认引导"],
    ["fallback", "按需接管", "存在自定义或 Forge 提示词时接管，否则保留宿主默认（默认）"],
    ["always", "并存保留", "始终保留宿主 workspace 引导，与 Forge 提示词并存"],
  ];
  return h("div", null,
    h("div", { className: "df-policy" }, options.map(([id, title, desc]) =>
      h("div", { key: id, className: "df-opt" + (current === id ? " on" : ""), onClick: () => !busy && run(id, () => api("/policy", { method: "POST", body: JSON.stringify({ policy: id }) })) },
        h("b", null, title + (busy === id ? " · 保存中…" : "")), h("span", null, desc)
      )))
  );
}

function LogView({ logs, setLogs, busy, run }) {
  const load = useCallback(() => { api("/log?limit=200").then((d) => setLogs(d.entries || [])).catch(() => {}); }, [setLogs]);
  useEffect(() => { load(); }, [load]);
  return h("div", null,
    h("div", { className: "df-toolbar" },
      h("button", { className: "df-btn", disabled: !!busy, onClick: load }, "刷新日志"),
      h("button", { className: "df-btn danger", disabled: !!busy, onClick: () => run("clear-log", () => api("/log/clear", { method: "POST", body: "{}" }).then((r) => { setLogs([]); return r; })) }, "清空日志")
    ),
    h("section", { className: "df-sec" },
      h("h3", null, "forge.log.jsonl"),
      logs.length ? logs.map((l, i) => { const extra = Object.fromEntries(Object.entries(l).filter(([k]) => !["ts", "level", "event"].includes(k))); return h("div", { className: "df-log", key: i }, h("time", null, (l.ts || "").replace("T", " ").slice(0, 19)), `${l.level || "info"} · ${l.event}${Object.keys(extra).length ? " · " + JSON.stringify(extra) : ""}`); }) : h("div", { className: "df-empty" }, "暂无日志")
    )
  );
}

function ForgeIcon() {
  return h("div", { style: { width: 18, height: 18, display: "grid", placeItems: "center", color: "#f0b35b", font: "700 11px 'SF Mono',monospace" } }, "F");
}

export const name = NS;
export const inject = ["slots", "locale", "connection"];

export function apply(ctx) {
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "dsh-forge", order: 40, label: "Forge" }, ForgeIcon));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "dsh-forge" }, Shell));
}
