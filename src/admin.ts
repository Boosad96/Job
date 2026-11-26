export const dashboard = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JobRadar AI | Admin</title><link rel="stylesheet" href="/admin/style.css">
<main><header><strong>JobRadar AI</strong><span>Administration</span></header>
<form id="login"><label for="token">Administrator API token</label><div class="row"><input id="token" type="password" required autocomplete="off"><button>Sign in</button></div></form>
<p id="notice" role="status" aria-live="polite"></p>
<section id="workspace" hidden>
<div class="row"><h1>Overview</h1><button id="logout">Sign out</button></div>
<div id="stats" class="metrics"></div>
<h2>Job management</h2>
<form id="filters" class="row"><input aria-label="Search title or company" id="query" placeholder="Title or company"><select id="state" aria-label="Job status">
<option value="">All statuses</option><option>active</option><option>draft</option><option>closed</option><option>expired</option></select><button>Search</button></form>
<div id="jobs"></div><div class="row"><button id="previous">Previous</button><button id="next">Next</button></div>
<h2>Channel publication</h2><div id="publications"></div>
</section></main><script src="/admin/app.js" defer></script></html>`;

export const styles = `
:root{font:16px system-ui,sans-serif;color:#14253a;background:#f4f7fb}*{box-sizing:border-box}
body{margin:0}main{max-width:1060px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;
align-items:center;border-bottom:1px solid #cbd5e1;padding-bottom:20px;margin-bottom:24px}header strong{font-size:1.3rem}
h1,h2{letter-spacing:-.02em}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}
input,select,button{font:inherit;padding:9px 12px;border:1px solid #aab8c8;border-radius:6px;background:white;color:inherit}
input{min-width:0;flex:1}button{cursor:pointer;background:#1457af;color:white;border-color:#1457af}
button:disabled{opacity:.55;cursor:default}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:10px}
article,.metric{background:white;border:1px solid #d9e2ec;border-radius:8px;padding:14px;margin:8px 0;overflow-wrap:anywhere}
.metric strong{display:block;font-size:1.4rem}article h3{margin:0}a{color:#1457af}#notice{min-height:1.5em}
pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:480px){main{padding:14px}header{font-size:.9rem}}
`;

export const script = String.raw`
const byId = id => document.getElementById(id);
let token = '', page = 0;
const node = (name, text) => { const element = document.createElement(name); element.textContent = text; return element; };
const notice = value => { byId('notice').textContent = value; };
async function api(path, method='GET', body, headers={}) {
  const response = await fetch('/api/v1/' + path, {
    method, headers:{Authorization:'Bearer ' + token,'Content-Type':'application/json',...headers},
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? 'Request failed');
  return value.data;
}
function action(label, fn) {
  const button = node('button',label);
  button.onclick = async () => {
    button.disabled = true;
    try { await fn(); notice('Updated.'); } catch (error) { notice(error.message); }
    finally { button.disabled = false; }
  };
  return button;
}
async function load() {
  const params = new URLSearchParams({limit:'20',offset:String(page*20)});
  if (byId('query').value.trim()) params.set('q',byId('query').value.trim());
  if (byId('state').value) params.set('status',byId('state').value);
  const [stats,jobs,posts] = await Promise.all([api('admin/stats'),api('admin/jobs?'+params),api('admin/publications')]);
  byId('stats').replaceChildren(...Object.entries({...stats.totals,...Object.fromEntries(stats.jobs.map(row=>[row.status,row.count]))}).map(([key,value])=>{
    const box=node('div',''); box.className='metric'; box.append(node('strong',value),node('span',key)); return box;
  }));
  byId('jobs').replaceChildren(...jobs.map(job=>{
    const card=node('article','');
    const source=node('a','Official source'); source.href=job.officialSourceUrl; source.rel='noopener noreferrer'; source.target='_blank';
    card.append(node('h3',job.title),node('p',[job.company,job.country,job.status,job.verifiedAt ? 'Verified' : null].filter(Boolean).join(' · ')),source);
    const row=node('div',''); row.className='row';
    for (const status of ['active','draft','closed']) if (status!==job.status) row.append(action('Set '+status,async()=>{
      await api('jobs/'+job.id,'PATCH',{status},{'If-Match':JSON.stringify(String(job.version))}); await load();
    }));
    card.append(row); return card;
  }));
  byId('previous').disabled=page===0;
  byId('next').disabled=jobs.length<20;
  byId('publications').replaceChildren(...posts.map(post=>{
    const card=node('article',''); card.append(node('h3',post.title),node('p',post.state),node('pre',post.text));
    if (['pending','approved','rejected'].includes(post.state)) for (const mode of ['approve','reject']) {
      card.append(action(mode,async()=>{await api('channel/publish','POST',{jobId:post.job_id,action:mode});await load();}));
    }
    return card;
  }));
}
byId('login').onsubmit = async event => {
  event.preventDefault();
  token=byId('token').value.trim(); byId('token').value='';
  try {await load();byId('login').hidden=true;byId('workspace').hidden=false;notice('');}
  catch(error){token='';notice(error.message);}
};
byId('logout').onclick=()=>{token='';location.reload();};
byId('filters').onsubmit=event=>{event.preventDefault();page=0;load().catch(error=>notice(error.message));};
byId('previous').onclick=()=>{page=Math.max(0,page-1);load().catch(error=>notice(error.message));};
byId('next').onclick=()=>{page++;load().catch(error=>notice(error.message));};
`;
