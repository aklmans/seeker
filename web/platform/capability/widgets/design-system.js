// @ts-check
/** Shared headless widget surface. Semantic HTML works without generated CSS.
 * Layout helpers are opt-in; content-specific diagrams still belong to the widget. */
export const WIDGET_CSS = `
:root{--creation-gap:20px;--creation-radius:8px;color-scheme:var(--widget-color-scheme,light)}
html{overflow-wrap:anywhere}body{padding:20px 24px;font-size:14px;line-height:1.65}
h1,h2{font-family:var(--font-serif);font-weight:500;letter-spacing:-.02em;line-height:1.3}
h1{font-size:26px}h2{font-size:22px}h3{font-size:15px}p{max-width:72ch}
label{color:var(--ink-2)}output{font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--ink)}
button{min-height:36px;border-radius:6px;padding:7px 12px;line-height:1.4}
button:disabled{opacity:.5;cursor:default}button[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
button.primary,button.btn-accent,button[data-accent]{color:var(--widget-on-accent,#fff)}
input,select,textarea{border-radius:6px;min-height:36px;max-width:100%;font:inherit;accent-color:var(--accent)}
textarea{resize:vertical}input[type=checkbox],input[type=radio]{min-height:0;padding:0;width:16px;height:16px;vertical-align:middle}
input[type=range]{appearance:none;-webkit-appearance:none;display:block;width:100%;height:28px;min-height:28px;padding:0;border:0;border-radius:0;background:transparent;cursor:pointer;accent-color:var(--accent)}
input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--border-strong)}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-6px;border:2px solid var(--bg-elevated);border-radius:50%;background:var(--accent);box-shadow:0 0 0 .5px var(--border-strong)}
input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--border-strong)}
input[type=range]::-moz-range-thumb{width:12px;height:12px;border:2px solid var(--bg-elevated);border-radius:50%;background:var(--accent)}
:where(button,input,select,textarea,summary,a):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
svg,canvas,img{max-width:100%}svg text{font-family:var(--font-sans)}
details{border-top:.5px solid var(--border);padding-top:12px}summary{cursor:pointer;color:var(--ink-2)}
.sw-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,260px);gap:var(--creation-gap);align-items:start}
.sw-layout>*{min-width:0}.sw-stack{display:grid;gap:var(--creation-gap)}
.sw-section{padding-block:16px;border-top:.5px solid var(--border)}
.sw-controls{display:grid;gap:16px;padding:16px;background:var(--bg-subtle);border-radius:var(--creation-radius)}
.sw-field{display:grid;grid-template-columns:1fr auto;gap:6px 12px;font-size:12px;align-items:center}
.sw-field>input,.sw-field>select,.sw-field>textarea,.sw-field>small{grid-column:1/-1}
.sw-field>output{font-size:13px;white-space:nowrap;min-width:3ch;text-align:right}.sw-field>small{font-family:var(--font-sans);text-transform:none;letter-spacing:0}
.sw-chart{min-width:0}.sw-chart>svg{display:block;width:100%;height:auto}
.sw-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:16px;padding-block:16px;border-block:.5px solid var(--border);margin:16px 0}
.sw-stat>small{display:block;letter-spacing:.04em}.sw-stat>output,.sw-stat>strong{display:block;font:500 23px/1.4 var(--font-mono);font-variant-numeric:tabular-nums;margin-top:4px;color:var(--ink)}
.sw-legend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:12px;color:var(--ink-2);margin-block:12px}
.sw-note{padding:12px 0 12px 14px;border-left:2px solid var(--accent);color:var(--ink-2);font-size:13px}
.sw-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
@media(max-width:640px){body{padding:16px}.sw-layout{grid-template-columns:minmax(0,1fr)}h1{font-size:23px}h2{font-size:20px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
