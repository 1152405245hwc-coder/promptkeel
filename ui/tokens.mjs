/**
 * Shared console themes for the :7788 workbench. Light warm paper is the
 * default; `[data-theme="dark"]` switches to warm charcoal. The CTA fill is
 * one step darker than the terracotta accent so white label text clears 4.5:1.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export const CONSOLE_CSS = `
:root,[data-theme="light"]{
  color-scheme:light;
  --bg:#FAF9F5;--chrome:#F4F2EB;--chrome-line:#E4E0D6;
  --panel:#FFFFFF;--panel2:#F7F5F0;--recessed:#F5F3EC;--code:#EFECE4;
  --line:#E5E1D8;--line-hi:#DAD5C9;--line-soft:#E8E4DB;
  --text:#1F1E1D;--dim:#5C5953;--mute:#736F68;--code-ink:#1F1E1D;
  --accent:#C05A38;--accent-ink:#B15033;--accent-fill:#BC5836;--accent-hover:#AA4D2E;--on-accent:#FFFFFF;--focus:#C05A38;
  --ok:#1E6B42;--ok-bg:#E9F5EE;--ok-border:#BFE0CC;
  --warn:#965812;--warn-bg:#FDF3E2;--warn-border:#ECD0A1;
  --bad:#B42318;--bad-bg:#FDECEB;--bad-border:#F2BCB7;
  --elev:0 1px 2px rgba(28,25,21,.04);--shadow-modal:0 16px 40px rgba(28,25,21,.12);
  --backdrop:rgba(31,30,29,.36);--nav-hover:#E9E4D8;--row:#F7F5F0;--row-hover:#F8EDE7;
  --bar-track:#E5E1D8;--radius:12px
}
[data-theme="dark"]{
  color-scheme:dark;
  --bg:#1E1E1C;--chrome:#181816;--chrome-line:#3A3833;
  --panel:#2A2926;--panel2:#32312C;--recessed:#232220;--code:#232220;
  --line:#3A3833;--line-hi:#4A4740;--line-soft:#3A3833;
  --text:#ECEBE6;--dim:#B5B2A8;--mute:#949188;--code-ink:#ECEBE6;
  --accent:#D97757;--accent-ink:#D97757;--accent-fill:#BC5836;--accent-hover:#AA4D2E;--on-accent:#FFFFFF;--focus:#D97757;
  --ok:#9ED9B4;--ok-bg:#163226;--ok-border:#2F6B4A;
  --warn:#E7C07A;--warn-bg:#3A2C18;--warn-border:#8A6230;
  --bad:#F0B4AC;--bad-bg:#3A2220;--bad-border:#8A4540;
  --elev:0 1px 2px rgba(0,0,0,.35);--shadow-modal:0 16px 40px rgba(0,0,0,.45);
  --backdrop:rgba(12,12,10,.72);--nav-hover:#32312C;--row:#32312C;--row-hover:#3A322C;
  --bar-track:#3A3833;--radius:12px
}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:14px/1.6 "SF Pro Text","PingFang SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit;color:inherit}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px 18px;flex-wrap:wrap;padding:10px 22px;border-bottom:1px solid var(--chrome-line);background:var(--chrome)}
.brand{display:flex;align-items:center;gap:9px;font:700 12.5px/1 "SF Mono",ui-monospace,monospace;letter-spacing:.18em;color:var(--text);flex:none}
.mark{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;color:var(--on-accent);background:var(--accent-fill);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
.nav{display:flex;align-items:stretch;flex-wrap:wrap;gap:4px 0;min-width:0}
.nav-group{display:flex;flex-direction:column;justify-content:flex-end;gap:3px;padding:2px 10px 0}
.nav-group + .nav-group{border-left:1px solid var(--line)}
.nav-k{font-size:10px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);line-height:1}
.nav-group.is-current .nav-k{color:var(--accent-ink)}
.nav-links{display:flex;flex-wrap:wrap;gap:2px}
.nav a{padding:4px 8px;border-radius:8px;color:var(--dim);font-size:12.5px;transition:background .15s ease,color .15s ease}
.nav a:hover{color:var(--text);background:var(--nav-hover)}
.nav a[aria-current]{color:var(--on-accent);background:var(--accent-fill);font-weight:650}
.nav a[aria-current]:hover{background:var(--accent-hover);color:var(--on-accent)}
.top-meta{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}
.theme-toggle{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:4px 10px;border-radius:8px;border:1px solid var(--line-hi);background:var(--panel);color:var(--text);cursor:pointer;font-size:12.5px;font-weight:600}
.theme-toggle:hover{border-color:var(--accent);color:var(--accent-ink)}
.theme-icon{width:14px;height:14px;flex:none}
.theme-icon-sun,.theme-label-light{display:none}
[data-theme="dark"] .theme-icon-moon,[data-theme="dark"] .theme-label-dark{display:none}
[data-theme="dark"] .theme-icon-sun{display:block}
[data-theme="dark"] .theme-label-light{display:inline}
.spacer{flex:1}
.wrap{max-width:1160px;margin:0 auto;padding:24px 24px 48px}
.hero{margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.hero h1{margin:0 0 4px;font-size:21px;letter-spacing:-.01em;font-weight:650}
.hero p{margin:0;color:var(--dim);font-size:12.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(184px,1fr));gap:11px;margin-bottom:20px}
.split{display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:13px 15px;box-shadow:var(--elev)}
.card[data-tone="ok"]{border-color:var(--ok-border)}
.card[data-tone="warn"]{border-color:var(--warn-border)}
.card[data-tone="bad"]{border-color:var(--bad-border)}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.card-head .k{margin-bottom:0}
.card-flag{flex:none}
.card .k{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin-bottom:7px}
.card .v{margin-top:7px;font:650 21px/1.15 "SF Mono",ui-monospace,monospace;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--text)}
.card[data-tone="ok"] .v{color:var(--ok)}
.card[data-tone="warn"] .v{color:var(--warn)}
.card[data-tone="bad"] .v{color:var(--bad)}
.card .hint{margin-top:5px;font-size:11.5px;color:var(--dim)}
.meter-row{display:flex;align-items:center;gap:8px;margin-top:9px}
.meter-row .bar{flex:1;margin-top:0}
.meter-pct{min-width:36px;text-align:right;font:600 11px/1 "SF Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;color:var(--dim)}
.card[data-tone="ok"] .meter-pct{color:var(--ok)}
.card[data-tone="warn"] .meter-pct{color:var(--warn)}
.card[data-tone="bad"] .meter-pct{color:var(--bad)}
.bar{margin-top:9px;height:8px;border-radius:999px;background:var(--bar-track);border:1px solid var(--line);overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:var(--ok)}
.bar.warn span{background:var(--warn)}
.bar.bad span{background:var(--bad)}
.bar.is-empty{background:var(--bad-bg);border-color:var(--bad-border)}
.sec{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:16px;overflow:hidden;box-shadow:var(--elev)}
.sec>h2{margin:0;padding:11px 15px;font-size:11.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);background:var(--panel2);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px}
.pad{padding:14px 16px}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.wb-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end}
.wb-compile{display:flex}
.wb-compile .btn{min-height:34px;padding-inline:16px;white-space:nowrap}
.advanced{margin-top:12px}
.advanced > summary{display:flex;align-items:baseline;gap:8px;min-height:32px;width:fit-content;max-width:100%;cursor:pointer;list-style:none;color:var(--text);font-size:12.5px}
.advanced > summary::-webkit-details-marker{display:none}
.advanced > summary::before{content:"";width:6px;height:6px;border-right:1.5px solid var(--dim);border-bottom:1.5px solid var(--dim);transform:rotate(-45deg);margin-right:2px;flex:none;transition:transform .15s ease}
.advanced[open] > summary::before{transform:rotate(45deg);margin-top:2px}
.advanced > summary .hint{color:var(--dim);font-size:12px}
.form-advanced{margin-top:10px;grid-template-columns:repeat(4,minmax(0,1fr))}
label.field{display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:var(--dim);min-width:0}
input,select,textarea{background:var(--recessed);border:1px solid var(--line-hi);border-radius:8px;padding:7px 10px;color:var(--text);font-size:12.5px}
label.field input,label.field select,label.field textarea{width:100%}
input:focus-visible,select:focus-visible,textarea:focus-visible,.codebox:focus-visible{outline:2px solid var(--focus);outline-offset:1px;border-color:var(--accent)}
textarea{min-height:92px;resize:vertical;font-family:"SF Mono",ui-monospace,monospace;font-size:12px}
.btn-groups{display:flex;flex-wrap:wrap;align-items:center;gap:8px 0;margin-top:14px}
.btn-groups .btn-row + .btn-row{margin-left:12px;padding-left:12px;border-left:1px solid var(--line)}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{min-height:32px;padding:6px 12px;border-radius:8px;border:1px solid var(--line-hi);background:var(--panel);color:var(--text);cursor:pointer;font-size:12.5px;transition:border-color .15s ease,background .15s ease,color .15s ease}
.btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent-ink)}
.btn:focus-visible,.nav a:focus-visible,.theme-toggle:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px;scroll-margin-top:76px}
.btn.primary{border-color:var(--accent-fill);background:var(--accent-fill);color:var(--on-accent);font-weight:600}
.btn.primary:hover:not(:disabled){border-color:var(--accent-hover);background:var(--accent-hover);color:var(--on-accent)}
.btn.ok,.btn.is-copied{border-color:var(--ok-border);background:var(--ok-bg);color:var(--ok)}
.btn.apply{border-color:var(--accent);background:transparent;color:var(--accent-ink)}
.btn.apply:hover:not(:disabled){background:var(--row-hover);border-color:var(--accent);color:var(--accent-ink)}
.btn.danger{border-color:var(--bad-border);background:var(--bad-bg);color:var(--bad)}
.btn.is-on{border-color:var(--accent);color:var(--accent-ink)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.wb-note{margin-top:12px;color:var(--dim)}
.wb-probe{margin-top:4px;color:var(--ok);min-height:1.2em}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--mute);padding:9px 15px;border-bottom:1px solid var(--line);font-weight:600;white-space:nowrap}
td{padding:9px 15px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
td .mono{overflow-wrap:anywhere}
tr:has(.status-detail) td{vertical-align:top}
tbody tr:nth-child(even){background:var(--row)}
tbody tr:hover{background:var(--row-hover)}
tbody tr:last-child td{border-bottom:0}
.mono{font-family:"SF Mono",ui-monospace,monospace;font-size:12.5px;color:var(--code-ink)}
.codebox{margin:0;padding:14px 16px;background:var(--code);max-height:min(520px,62vh);overflow:auto;font:12.5px/1.7 "SF Mono",ui-monospace,monospace;color:var(--code-ink);white-space:pre-wrap;word-break:break-word;border-top:1px solid var(--line);tab-size:2}
.codebox.is-nowrap{white-space:pre;word-break:normal}
.codebox:empty::before{content:"Compile a plan to preview the prompt.";color:var(--mute)}
.sec-tools{display:flex;gap:6px;align-items:center}
.sec > h2 .btn{text-transform:none;letter-spacing:0;font-weight:600}
.chip{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;letter-spacing:.02em;border:1px solid var(--line);color:var(--dim);background:var(--recessed);white-space:nowrap}
.chip.ok{color:var(--ok);border-color:var(--ok-border);background:var(--ok-bg)}
.chip.warn{color:var(--warn);border-color:var(--warn-border);background:var(--warn-bg)}
.chip.bad{color:var(--bad);border-color:var(--bad-border);background:var(--bad-bg)}
.kv{display:grid;grid-template-columns:180px 1fr;gap:0}
.kv div{padding:9px 15px;border-bottom:1px solid var(--line-soft)}
.kv div:nth-child(odd){color:var(--dim)}
.kv div:nth-last-child(-n+2){border-bottom:0}
.personas{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:11px;padding:15px}
.persona{border:1px solid var(--line);border-radius:10px;padding:13px 15px;background:var(--panel2)}
.persona b{font:650 13px/1.4 "SF Mono",ui-monospace,monospace;color:var(--accent-ink)}
.persona p{margin:7px 0 0;color:var(--dim);font-size:12px}
.toast{position:fixed;right:20px;bottom:20px;z-index:40;max-width:420px;padding:10px 14px;border-radius:10px;border:1px solid var(--line-hi);background:var(--panel);color:var(--text);box-shadow:var(--shadow-modal);font-size:12.5px}
.toast.ok{border-color:var(--ok-border);background:var(--ok-bg);color:var(--ok)}
.toast.bad{border-color:var(--bad-border);background:var(--bad-bg);color:var(--bad)}
.modal-backdrop{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:var(--backdrop);padding:18px}
.modal{width:min(520px,100%);background:var(--panel);border:1px solid var(--line-hi);border-radius:14px;overflow:hidden;box-shadow:var(--shadow-modal)}
.modal h3{margin:0;padding:13px 16px;font-size:14px;background:var(--panel2);border-bottom:1px solid var(--line);color:var(--text)}
.modal .mbody{padding:15px 16px;font-size:13px;color:var(--dim)}
.modal .mfoot{padding:12px 16px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--line);background:var(--panel2)}
.status-detail{display:flex;flex-flow:row wrap;align-items:center;gap:6px 10px;min-width:0}
.status-fold[open]{flex-basis:100%}
.status-summary{display:flex;flex-wrap:wrap;gap:6px}
.status-fold > summary{display:inline-flex;align-items:center;gap:6px;min-height:28px;cursor:pointer;list-style:none;color:var(--dim);font-size:12px}
.status-fold > summary::-webkit-details-marker{display:none}
.status-fold > summary::before{content:"";width:5px;height:5px;border-right:1.5px solid var(--mute);border-bottom:1.5px solid var(--mute);transform:rotate(-45deg);margin-top:-2px;flex:none;transition:transform .15s ease}
.status-fold[open] > summary::before{transform:rotate(45deg);margin-top:0}
.status-fold .when-open{display:none}
.status-fold[open] .when-closed{display:none}
.status-fold[open] .when-open{display:inline}
.chip-cloud{display:flex;flex-wrap:wrap;gap:6px;max-width:760px;padding-top:4px}
.chip-k{margin-top:4px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.chip-n{letter-spacing:0;color:var(--dim)}
.empty{padding:28px;text-align:center;color:var(--mute)}
footer{padding:18px 24px 30px;text-align:center;color:var(--mute);font-size:11.5px}
@media (max-width:980px){
  .wb-main{grid-template-columns:repeat(2,minmax(0,1fr))}
  .wb-compile{grid-column:1 / -1}
  .wb-compile .btn{width:100%}
  .form-advanced{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:860px){.split{grid-template-columns:1fr}}
@media (max-width:720px){.btn-groups .btn-row + .btn-row{margin-left:0;padding-left:0;border-left:0}}
@media (max-width:640px){.wrap{padding:16px 14px 30px}.kv{grid-template-columns:1fr}.kv div{padding:6px 14px}.kv div:nth-child(odd){border-bottom:0;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.nav-group{padding:4px 0}.nav-group + .nav-group{border-left:0}}
@media (max-width:560px){.wb-main,.form-advanced{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important}
}
@media print{body{background:#fff;color:#111}.top,.nav,footer,.toast,.modal-backdrop{display:none}.sec,.card{border-color:#ddd;background:#fff}}
`;
