export const publicCss = `
:root {
  color-scheme: light;
  --ink: #172339;
  --muted: #526078;
  --line: #dce3ee;
  --paper: #fff;
  --background: #f8fafc;
  --accent: #1d4ec5;
  --tint: #eaf0ff;
  font: 100%/1.6 system-ui, -apple-system, sans-serif;
  color: var(--ink);
  background: var(--background);
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; }
a { color: var(--accent); text-underline-offset: .2em; }
a:hover { text-decoration-thickness: .13em; }
:focus-visible { outline: .18rem solid var(--accent); outline-offset: .2rem; }
p { margin: 0 0 1rem; }
h1, h2, h3 { line-height: 1.15; margin: 0 0 .75rem; letter-spacing: -.025em; }
h1 { font-size: clamp(2.15rem, 5.6vw, 4.25rem); }
h2 { font-size: clamp(1.35rem, 3vw, 1.8rem); }
h3 { font-size: 1.2rem; }
.wrap { width: min(72rem, calc(100% - 2rem)); margin-inline: auto; }
main { flex: 1; padding-block: 2rem 4rem; overflow-wrap: anywhere; }
.skip { position: absolute; top: .5rem; left: .5rem; padding: .55rem; background: var(--paper); }
.skip:not(:focus) { clip-path: inset(50%); }
.site-header, .site-footer { background: var(--paper); }
.site-header { border-bottom: 1px solid var(--line); }
.site-footer { border-top: 1px solid var(--line); }
.header-inner, .footer-inner { display: flex; align-items: center; flex-wrap: wrap; gap: .65rem 1.5rem; padding-block: 1rem; }
.header-inner { justify-content: space-between; }
.footer-inner { padding-block: 1.5rem; }
.site-header nav, .site-footer nav { display: flex; flex-wrap: wrap; gap: .45rem 1.4rem; }
.site-header nav a, .site-footer nav a { color: var(--muted); font-size: .9375rem; text-decoration: none; }
.site-header nav a:hover, .site-footer nav a:hover { color: var(--accent); text-decoration: underline; }
.wordmark { font-size: 1.2rem; font-weight: 800; letter-spacing: -.035em; color: var(--ink); text-decoration: none; white-space: nowrap; }
.wordmark span { color: var(--accent); }
.hero { background: var(--tint); border-radius: 1.25rem; padding: clamp(1.3rem, 5vw, 4.25rem); }
.hero h1 { max-width: 16ch; }
.hero p { font-size: 1.1rem; color: var(--muted); max-width: 50ch; margin-bottom: 1.4rem; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: .65rem; }
.button, .chips a {
  display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem;
  border: 1px solid var(--line); border-radius: .55rem; padding: .55rem .95rem;
  background: var(--paper); color: var(--accent); font: inherit; font-weight: 650;
  text-align: center; text-decoration: none; cursor: pointer;
}
.button:hover, .chips a:hover { border-color: var(--accent); }
.primary { background: var(--accent); border-color: var(--accent); color: white; }
.primary:hover { background: #173e9e; }
.chips a { min-height: 2.5rem; font-size: .9rem; border-radius: 2rem; color: var(--ink); }
.chips a[aria-current] { background: var(--tint); border-color: transparent; color: var(--accent); }
.listing { margin-top: 2.25rem; }
.listing h2 { margin-bottom: 1rem; }
.job-list { padding: 0; list-style: none; margin: 1rem 0 0; display: grid; gap: .75rem; }
.job-card, .search-form, .empty, .facts {
  background: var(--paper); border: 1px solid var(--line); border-radius: .85rem; padding: 1.2rem;
}
.job-card { height: 100%; }
.job-card h3 { margin-bottom: .5rem; }
.job-card h3 a { text-decoration: none; }
.job-card h3 a:hover { text-decoration: underline; }
.job-card p { margin: 0; }
.company { font-weight: 675; }
.muted { color: var(--muted); }
.deadline { color: var(--accent); font-weight: 650; }
.job-card .deadline { margin-top: .5rem; }
.empty { color: var(--muted); margin: 1rem 0 0; }
.notice { background: var(--tint); border-left: .22rem solid var(--accent); padding: .65rem 1rem; margin-top: 1rem; }
.pagination { margin-top: 1.25rem; }
.page-heading { margin-bottom: 1.25rem; }
.page-heading h1 { font-size: clamp(2rem, 5vw, 3.25rem); }
.detail, .prose { max-width: 50rem; }
.detail .page-heading > a { display: inline-block; margin-bottom: .8rem; }
.detail .page-heading .company { font-size: 1.15rem; }
.facts { display: grid; gap: 1rem; margin-block: 1.5rem; }
.facts div { min-width: 0; }
.facts dt { color: var(--muted); font-size: .9rem; }
.facts dd { margin: .15rem 0 0; font-weight: 600; }
.description { margin-block: 1.75rem; }
.description p { white-space: pre-wrap; }
.job-actions { margin-top: 1.5rem; }
.prose h2 { margin-top: 1.6rem; }
.search-form label { display: grid; gap: .3rem; font-weight: 600; }
input, select {
  color: var(--ink); background: var(--paper); border: 1px solid #aab7ca; border-radius: .45rem;
  font: inherit; width: 100%; min-width: 0; min-height: 2.75rem; padding: .4rem .65rem;
}
select { appearance: none; padding-inline-end: 2rem; }
.search-form label:has(select) { position: relative; }
.search-form label:has(select)::after {
  content: ""; position: absolute; right: .9rem; bottom: 1.1rem; width: .45rem; height: .45rem;
  border: solid var(--muted); border-width: 0 2px 2px 0; transform: rotate(45deg); pointer-events: none;
}
.search-form .actions { margin-top: 1rem; }
.filters { display: grid; gap: .8rem; margin-top: .8rem; }
@media (min-width: 35rem) {
  .wrap { width: min(72rem, calc(100% - 4rem)); }
  .job-list, .filters, .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 60rem) {
  main { padding-top: 2.75rem; }
  .job-list, .filters { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
`;
