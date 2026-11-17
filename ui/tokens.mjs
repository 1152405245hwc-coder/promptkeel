/**
 * Shared dark-engineering UI design tokens and CSS primitives for both the
 * standalone :7788 local workbench (`core/console.mjs`) and DSH sidebar preview.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export const CONSOLE_CSS = `
:root{--bg:#0b0e13;--panel:#141b24;--panel2:#18212c;--line:#232d3a;--line-hi:#334154;--text:#e7eef6;--dim:#8a97a6;--mute:#5d6a79;--amber:#f0b35b;--green:#5fd39b;--red:#ef6b73;--blue:#6cb6ff;--radius:12px}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 620px at 18% -12%,#16202b 0,#0b0e13 58%);color:var(--text);font:14px/1.6 "SF Pro Text","PingFang SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit;color:inherit}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 24px;border-bottom:1px solid var(--line);background:rgba(11,14,19,.88);backdrop-filter:blur(12px)}
.brand{display:flex;align-items:center;gap:9px;font:700 12.5px/1 "SF Mono",ui-monospace,monospace;letter-spacing:.18em;color:var(--amber)}
.mark{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;color:#1a1206;background:linear-gradient(145deg,rgba(240,179,91,.95),rgba(240,179,91,.3));box-shadow:inset 0 0 0 1px rgba(240,179,91,.4)}
.nav{display:flex;gap:2px;flex-wrap:wrap}
.nav a{padding:6px 11px;border-radius:8px;color:var(--dim);font-size:12.5px;transition:background .15s ease,color .15s ease}
.nav a:hover{color:var(--text);background:#182130}
.nav a[aria-current]{color:#171006;background:var(--amber);font-weight:650}
.spacer{flex:1}
.wrap{max-width:1160px;margin:0 auto;padding:24px 24px 48px}
.hero{margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.hero h1{margin:0 0 4px;font-size:21px;letter-spacing:-.01em}
.hero p{margin:0;color:var(--dim);font-size:12.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(184px,1fr));gap:11px;margin-bottom:20px}
.split{display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:var(--radius);padding:13px 15px}
.card .k{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin-bottom:7px}
.card .v{font:650 21px/1.15 "SF Mono",ui-monospace,monospace;letter-spacing:-.02em}
.card .hint{margin-top:5px;font-size:11.5px;color:var(--dim)}
.bar{margin-top:9px;height:5px;border-radius:999px;background:#1d2632;overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--green),#8ee0ba)}
.bar.warn span{background:linear-gradient(90deg,var(--amber),#f6d09a)}
.sec{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}
.sec>h2{margin:0;padding:11px 15px;font-size:11.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);background:var(--panel2);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px}
.pad{padding:14px 16px}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
label.field{display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:var(--dim)}
input,select,textarea{background:#0d1218;border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--text);font-size:12.5px}
input:focus,select:focus,textarea:focus{outline:2px solid rgba(240,179,91,.45);border-color:var(--amber)}
textarea{min-height:92px;resize:vertical;font-family:"SF Mono",ui-monospace,monospace;font-size:12px}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;font-size:12.5px;transition:border-color .15s ease,background .15s ease,color .15s ease}
.btn:hover:not(:disabled){border-color:var(--amber);color:var(--amber)}
.btn:focus-visible{outline:2px solid rgba(240,179,91,.6);outline-offset:1px}
.btn.primary{border-color:rgba(240,179,91,.55);background:rgba(240,179,91,.15);color:var(--amber);font-weight:600}
.btn.ok{border-color:rgba(95,211,155,.5);background:rgba(95,211,155,.12);color:var(--green)}
.btn.danger{border-color:rgba(239,107,115,.5);background:rgba(239,107,115,.1);color:var(--red)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--mute);padding:9px 15px;border-bottom:1px solid var(--line);font-weight:600;white-space:nowrap}
td{padding:9px 15px;border-bottom:1px solid rgba(35,45,58,.6);vertical-align:middle}
tbody tr:nth-child(even){background:rgba(24,33,44,.42)}
tbody tr:hover{background:rgba(240,179,91,.05)}
tbody tr:last-child td{border-bottom:0}
.mono{font-family:"SF Mono",ui-monospace,monospace;font-size:12.5px}
.codebox{margin:0;padding:13px 15px;background:#0a0e12;max-height:420px;overflow:auto;font:12px/1.55 "SF Mono",ui-monospace,monospace;color:#cdd8e3;white-space:pre-wrap;word-break:break-word;border-top:1px solid var(--line)}
.chip{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;letter-spacing:.02em;border:1px solid var(--line);color:var(--dim);background:rgba(255,255,255,.02);white-space:nowrap}
.chip.ok{color:var(--green);border-color:rgba(95,211,155,.34);background:rgba(95,211,155,.08)}
.chip.warn{color:var(--amber);border-color:rgba(240,179,91,.34);background:rgba(240,179,91,.08)}
.chip.bad{color:var(--red);border-color:rgba(239,107,115,.34);background:rgba(239,107,115,.08)}
.kv{display:grid;grid-template-columns:180px 1fr;gap:0}
.kv div{padding:9px 15px;border-bottom:1px solid rgba(35,45,58,.6)}
.kv div:nth-child(odd){color:var(--dim)}
.kv div:nth-last-child(-n+2){border-bottom:0}
.personas{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:11px;padding:15px}
.persona{border:1px solid var(--line);border-radius:10px;padding:13px 15px;background:var(--panel2)}
.persona b{font:650 13px/1.4 "SF Mono",ui-monospace,monospace;color:var(--amber)}
.persona p{margin:7px 0 0;color:var(--dim);font-size:12px}
.toast{position:fixed;right:20px;bottom:20px;z-index:40;max-width:420px;padding:10px 14px;border-radius:10px;border:1px solid var(--line-hi);background:var(--panel2);color:var(--text);box-shadow:0 12px 32px rgba(0,0,0,.45);font-size:12.5px}
.toast.ok{border-color:rgba(95,211,155,.5);color:var(--green)}
.toast.bad{border-color:rgba(239,107,115,.5);color:var(--red)}
.modal-backdrop{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(5,7,10,.72);padding:18px}
.modal{width:min(520px,100%);background:var(--panel);border:1px solid var(--line-hi);border-radius:14px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.6)}
.modal h3{margin:0;padding:13px 16px;font-size:14px;background:var(--panel2);border-bottom:1px solid var(--line)}
.modal .mbody{padding:15px 16px;font-size:13px;color:var(--dim)}
.modal .mfoot{padding:12px 16px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--line);background:var(--panel2)}
.empty{padding:28px;text-align:center;color:var(--mute)}
footer{padding:18px 24px 30px;text-align:center;color:var(--mute);font-size:11.5px}
@media (max-width:860px){.split{grid-template-columns:1fr}}
@media (max-width:640px){.wrap{padding:16px 14px 30px}.kv{grid-template-columns:1fr}.kv div{padding:6px 14px}.kv div:nth-child(odd){border-bottom:0;font-size:11px;text-transform:uppercase;letter-spacing:.08em}}
@media print{body{background:#fff;color:#111}.top,.nav,footer,.toast,.modal-backdrop{display:none}.sec,.card{border-color:#ddd;background:#fff}}
`;
