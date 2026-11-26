import { z } from 'zod';
import { filtersSchema, type Filters, type Listing } from './model';
import { isActive, lookup, publicSiteOrigin, search, unpack, type Env, type JobRow } from './store';

const dictionary = {
  en: {
    menu:'JobRadar AI', search:'Search', saved:'Saved jobs', searches:'Saved searches', match:'Match my qualification',
    lang:'বাংলা', referral:'Invite a friend', channel:'West Bengal job alerts', apply:'Apply', source:'Official source',
    save:'Save', remove:'Remove', share:'Share', next:'Next', daily:'Daily alerts', instant:'Instant alerts',
    off:'Save without alerts', empty:'No matching jobs.', savedOk:'Saved.', removed:'Removed.', deleted:'Your stored data has been deleted.',
    criteria:'Enter filters as key=value separated by |, for example country=IN | city=Kolkata | skills=Excel. You can also enter a keyword.',
    invalid:'Invalid filters. Use /help for the supported filters.', qualification:'Set your qualification with /qualification followed by the exact qualification, for example /qualification Bachelor of Commerce.',
    deleteConfirm:'Delete your profile, saved jobs and searches?', confirm:'Delete my data', latest:'Latest jobs',
    remote:'International remote', govt:'Government', private:'Private', fresher:'Fresher', part:'Part-time', visa:'Visa sponsorship',
    edit:'Edit filters', alertEmpty:'No saved searches.', disabled:'Sharing is unavailable until the bot username is configured.',
    results:'Search results', alert:'Matching job alerts', page:'Page', clear:'Clear filters', expired:'This job is no longer accepting applications.',
    experience:'Minimum experience (years)', salary:'Salary', qualificationLabel:'Qualification', skillsLabel:'Skills',
    deadline:'Deadline', type:'Employment', unspecified:'Not specified', cancel:'Cancel', stale:'These results are out of date. Run your search again.', searchLimit:'You can save up to 20 searches. Remove one to save another.'
  },
  bn: {
    menu:'JobRadar AI', search:'খুঁজুন', saved:'সংরক্ষিত চাকরি', searches:'সংরক্ষিত অনুসন্ধান', match:'যোগ্যতা অনুযায়ী চাকরি',
    lang:'English', referral:'বন্ধুকে আমন্ত্রণ', channel:'পশ্চিমবঙ্গের চাকরির খবর', apply:'আবেদন', source:'অফিসিয়াল সূত্র',
    save:'সংরক্ষণ', remove:'সরান', share:'শেয়ার', next:'পরবর্তী', daily:'দৈনিক খবর', instant:'তাৎক্ষণিক খবর',
    off:'খবর ছাড়া সংরক্ষণ', empty:'মিলে যাওয়া চাকরি নেই।', savedOk:'সংরক্ষিত।', removed:'সরানো হয়েছে।', deleted:'আপনার সংরক্ষিত তথ্য মুছে ফেলা হয়েছে।',
    criteria:'| দিয়ে আলাদা করে key=value ফিল্টার লিখুন, যেমন country=IN | city=Kolkata | skills=Excel। শুধু কীওয়ার্ডও লিখতে পারেন।',
    invalid:'অবৈধ ফিল্টার। ফিল্টারের তালিকার জন্য /help লিখুন।', qualification:'সঠিক যোগ্যতা লিখুন, যেমন /qualification Bachelor of Commerce।',
    deleteConfirm:'আপনার প্রোফাইল, সংরক্ষিত চাকরি ও অনুসন্ধান মুছবেন?', confirm:'আমার তথ্য মুছুন', latest:'সর্বশেষ চাকরি',
    remote:'আন্তর্জাতিক রিমোট', govt:'সরকারি', private:'বেসরকারি', fresher:'নতুনদের জন্য', part:'খণ্ডকালীন', visa:'ভিসা স্পনসরশিপ',
    edit:'ফিল্টার বদলান', alertEmpty:'সংরক্ষিত অনুসন্ধান নেই।', disabled:'বটের ইউজারনেম সেট করার পর শেয়ার করা যাবে।',
    results:'অনুসন্ধানের ফল', alert:'মিলে যাওয়া চাকরির খবর', page:'পৃষ্ঠা', clear:'ফিল্টার মুছুন', expired:'এই চাকরির আবেদন বন্ধ।',
    experience:'ন্যূনতম অভিজ্ঞতা (বছর)', salary:'বেতন', qualificationLabel:'যোগ্যতা', skillsLabel:'দক্ষতা',
    deadline:'শেষ তারিখ', type:'কাজের ধরন', unspecified:'উল্লেখ নেই', cancel:'বাতিল', stale:'এই ফলাফল পুরনো। আবার অনুসন্ধান করুন।', searchLimit:'সর্বোচ্চ ২০টি অনুসন্ধান সংরক্ষণ করা যায়। নতুনটি সংরক্ষণ করতে একটি সরান।'
  }
};
type Language = keyof typeof dictionary;
type User = {id:string; language:Language; filters:string; qualification:string|null; search_token:string|null; referral:string};
type Button = {text:string; callback_data?:string; url?:string};
const callback = (text:string, callback_data:string): Button => ({text,callback_data});
const link = (text:string, url:string): Button => ({text,url});
const wb = 'https://t.me/WBChakriAlert';
const regions = [['IN','India','ভারত'],['US','USA','যুক্তরাষ্ট্র'],['GB','UK','যুক্তরাজ্য'],['CA','Canada','কানাডা'],['AU','Australia','অস্ট্রেলিয়া'],['AE','UAE','সংযুক্ত আরব আমিরাত'],['DE','Germany','জার্মানি']];
export class TelegramError extends Error {
  constructor(readonly code:number, readonly retryAfter?:number) { super(`Telegram API error ${code}`); }
}
export async function telegram<T>(env:Env, method:string, body:object):Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram token unavailable');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(8000)
  });
  const data = await response.json<{ok:boolean; result:T; error_code?:number; parameters?:{retry_after?:number}}>();
  if (!response.ok || !data.ok) throw new TelegramError(data.error_code ?? response.status, data.parameters?.retry_after);
  return data.result;
}
function send(env:Env, id:string, text:string, buttons:Button[][] = []) {
  return telegram(env,'sendMessage',{chat_id:id,text,link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:buttons}});
}
function deepLink(env:Env, value:string) {
  return env.TELEGRAM_BOT_USERNAME && /^[a-zA-Z0-9_]{5,32}$/.test(env.TELEGRAM_BOT_USERNAME)
    ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${value}` : null;
}
function menu(env:Env, user:User) {
  const t = dictionary[user.language];
  const buttons = [[callback(t.search,'browse'),callback(t.latest,'preset:latest')],[callback(t.saved,'saved'),callback(t.searches,'searches')],
    [callback(t.match,'match'),callback(t.lang,'lang')],[callback(t.referral,'invite')]];
  if (user.language === 'bn') buttons.push([link(t.channel,wb)]);
  return send(env,user.id,t.menu,buttons);
}
function browse(env:Env,user:User) {
  const t = dictionary[user.language];
  const regionButtons = regions.map(([code,en,bn]) => callback(user.language === 'bn' ? bn : en,`country:${code}`));
  return send(env,user.id,t.search,[
    [callback(t.edit,'input'),callback(t.clear,'preset:latest')],
    ...Array.from({length:4},(_,i) => regionButtons.slice(i*2,i*2+2)),
    [callback(user.language === 'bn' ? 'পশ্চিমবঙ্গ' : 'West Bengal','preset:wb'),callback(t.remote,'preset:remote')],
    [callback(t.govt,'preset:government'),callback(t.private,'preset:private')],
    [callback(t.fresher,'preset:fresher'),callback(t.part,'preset:part'),callback(t.visa,'preset:visa')],
    [callback(t.menu,'menu')]
  ]);
}
function jobCard(env:Env,user:User,job:Listing,saved=false) {
  const t = dictionary[user.language];
  const isOpen = isActive(job);
  const share = deepLink(env,`j_${job.id.slice(0,60)}`);
  const buttons = [[link(t.source,job.officialSourceUrl)]];
  if (isOpen && job.applicationUrl) buttons[0].unshift(link(t.apply,job.applicationUrl));
  if (isOpen || saved) buttons.push([callback(saved ? t.remove : t.save,`${saved ? 'u' : 's'}:${job.id.slice(0,60)}`),
    ...(isOpen && share ? [link(t.share,`https://t.me/share/url?url=${encodeURIComponent(share)}&text=${encodeURIComponent(job.title)}`)] : [])]);
  const site = publicSiteOrigin(env.PUBLIC_SITE_URL);
  if (site) buttons.push([link('Full details', `${site}/jobs/${job.id}`)]);
  const salary = [job.minSalary,job.maxSalary].filter(value=>value!=null).join('–');
  return send(env,user.id,[
    job.title,job.company,[job.city,job.state,job.country].filter(Boolean).join(', '),
    isOpen ? '' : t.expired,
    job.employmentType && `${t.type} · ${job.employmentType}`,
    job.qualification && `${t.qualificationLabel} · ${job.qualification}`,
    job.skills?.length && `${t.skillsLabel} · ${job.skills.join(', ').slice(0,350)}`,
    job.experience != null && `${t.experience} · ${job.experience}`,
    salary && `${t.salary} · ${salary} ${job.currency ?? t.unspecified} ${job.salaryPeriod ?? ''}`,
    job.applicationDeadline && `${t.deadline} · ${job.applicationDeadline}`,
    job.description?.slice(0,700)
  ].filter(value=>value).join('\n'),buttons);
}
const presets: Record<string,Filters> = {
  latest:{}, wb:{country:'IN',state:'West Bengal',category:'government'}, remote:{remote:true},
  government:{category:'government'}, private:{category:'private'}, fresher:{experience:0}, part:{employmentType:'part-time'}, visa:{visaSponsorship:true}
};
async function results(env:Env,user:User,filters:Filters,page=0) {
  const t = dictionary[user.language];
  const jobs = await search(env.DB,filters,{limit:4,offset:page*3});
  for (const job of jobs.slice(0,3)) await jobCard(env,user,job);
  const buttons = [[callback(t.edit,'input'),callback(t.search,'browse')],
    [callback(t.off,`cadence:off:${user.search_token}`),callback(t.daily,`cadence:daily:${user.search_token}`),callback(t.instant,`cadence:instant:${user.search_token}`)]];
  if (jobs.length > 3 && page < 99) buttons.unshift([callback(t.next,`page:${page+1}:${user.search_token}`)]);
  if (user.language === 'bn' || filters.state?.toLowerCase() === 'west bengal') buttons.push([link(t.channel,wb)]);
  await send(env,user.id,jobs.length ? `${t.results} · ${t.page} ${page+1}` : t.empty,buttons);
}
async function setFilters(env:Env,user:User,filters:Filters) {
  user.search_token = crypto.randomUUID().slice(0,18);
  await env.DB.prepare('UPDATE users SET filters=?,search_token=? WHERE id=?').bind(JSON.stringify(filters),user.search_token,user.id).run();
  await results(env,user,filters);
}
export function parseTextFilters(text:string) {
  if (!text.includes('=')) return filtersSchema.parse({q:text});
  const pairs = text.split('|').map(part => {
    const index=part.indexOf('=');
    if (index < 1) throw new Error('Invalid filter');
    return [part.slice(0,index).trim(),part.slice(index+1).trim()];
  });
  return filtersSchema.parse(Object.fromEntries(pairs));
}
const identity = z.object({id:z.number().int().positive(),language_code:z.string().optional()});
const chat = z.object({id:z.number().int(),type:z.string()});
const message = z.object({chat,from:identity.optional(),text:z.string().optional()});
const updateSchema = z.object({
  update_id:z.number().int(), message:message.optional(), callback_query:z.object({
    id:z.string(), from:identity, data:z.string().optional(), message:z.object({chat}).optional()
  }).optional()
});
export async function handleUpdate(env:Env,body:unknown) {
  const update = updateSchema.parse(body);
  const query = update.callback_query;
  const sender = query?.from ?? update.message?.from;
  const target = query ? query.message?.chat : update.message?.chat;
  if (!sender || target?.type !== 'private' || target.id !== sender.id) return;
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO updates(id) VALUES(?)').bind(update.update_id).run();
  if (!claim.meta.changes) return;
  const id = String(sender.id);
  const text = update.message?.text?.trim() ?? '';
  const referral = text.match(/^\/start r_([0-9a-f]{20})$/)?.[1] ?? null;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO users(id,language,referral,referred_by) VALUES(?,?,?,(SELECT id FROM users WHERE referral=? AND id<>?))')
      .bind(id,sender.language_code?.startsWith('bn') ? 'bn' : 'en',crypto.randomUUID().replaceAll('-','').slice(0,20),referral,id).run();
    const user = (await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first<User>())!;
    const t = dictionary[user.language];
    const filters = JSON.parse(user.filters) as Filters;
    if (query) {
      await telegram(env,'answerCallbackQuery',{callback_query_id:query.id}).catch(()=>null);
      const [action,value,searchToken] = (query.data ?? '').split(':');
      switch(action) {
        case 'menu': return await menu(env,user);
        case 'browse': return await browse(env,user);
        case 'lang': {
          user.language = user.language === 'en' ? 'bn' : 'en';
          await env.DB.prepare('UPDATE users SET language=? WHERE id=?').bind(user.language,id).run();
          return await menu(env,user);
        }
        case 'input':
          return await send(env,id,t.criteria,[[callback(t.cancel,'cancel')]]);
        case 'cancel':
          return await menu(env,user);
        case 'country':
          if (regions.some(([code])=>code===value)) return await setFilters(env,user,{country:value});
          break;
        case 'preset':
          if (Object.hasOwn(presets,value)) return await setFilters(env,user,presets[value]);
          break;
        case 'page':
          if (!user.search_token || searchToken!==user.search_token) return await send(env,id,t.stale);
          if (/^\d{1,2}$/.test(value)) return await results(env,user,filters,Number(value));
          break;
        case 'match':
          return user.qualification ? await setFilters(env,user,{qualification:user.qualification}) : await send(env,id,t.qualification);
        case 'invite': {
          const url = deepLink(env,`r_${user.referral}`);
          return await send(env,id,url ?? t.disabled);
        }
        case 'saved': {
          const offset = /^\d{1,3}$/.test(value) ? Number(value) : 0;
          const {results:rows} = await env.DB.prepare('SELECT jobs.* FROM saved_jobs JOIN jobs ON jobs.id=job_id WHERE user_id=? ORDER BY jobs.created_at DESC,jobs.id DESC LIMIT 4 OFFSET ?').bind(id,offset).all<JobRow>();
          for (const row of rows.slice(0,3)) await jobCard(env,user,unpack(row),true);
          return await send(env,id,rows.length ? t.saved : t.empty,[
            ...(rows.length>3 && offset<996 ? [[callback(t.next,`saved:${offset+3}`)]] : []),[callback(t.menu,'menu')]]);
        }
        case 's':
        case 'u': {
          const job = await byPrefix(env,value);
          if (!job) break;
          if (action==='s' && !isActive(job)) return await send(env,id,t.expired);
          const sql = action==='s' ? 'INSERT OR IGNORE INTO saved_jobs VALUES(?,?)' : 'DELETE FROM saved_jobs WHERE user_id=? AND job_id=?';
          await env.DB.prepare(sql).bind(id,job.id).run();
          return await send(env,id,action==='s' ? t.savedOk : t.removed);
        }
        case 'cadence': {
          if (!user.search_token || searchToken!==user.search_token) return await send(env,id,t.stale);
          if (!['off','daily','instant'].includes(value)) break;
          const ordered = JSON.stringify(Object.fromEntries(Object.entries(filters).sort(([a],[b])=>a.localeCompare(b))));
          const now = Date.now();
          const due = value === 'daily' ? now+86400000 : now;
          await env.DB.prepare(`INSERT INTO searches(user_id,filters,cadence,cursor_time,due)
            SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM searches WHERE user_id=?)<20
              OR EXISTS(SELECT 1 FROM searches WHERE user_id=? AND filters=?)
            ON CONFLICT(user_id,filters) DO UPDATE SET cadence=excluded.cadence,due=excluded.due,
              cursor_time=CASE WHEN searches.cadence='off' THEN excluded.cursor_time ELSE searches.cursor_time END,
              cursor_id=CASE WHEN searches.cadence='off' THEN '' ELSE searches.cursor_id END`)
            .bind(id,ordered,value,new Date(now).toISOString(),due,id,id,ordered).run().then(async result => {
              if (!result.meta.changes) await send(env,id,t.searchLimit);
            });
          return await savedSearches(env,user);
        }
        case 'searches': return await savedSearches(env,user);
        case 'open':
        case 'drop': {
          const row = await env.DB.prepare('SELECT filters FROM searches WHERE user_id=? AND id=?').bind(id,value).first<{filters:string}>();
          if (!row) break;
          if (action==='open') return await setFilters(env,user,JSON.parse(row.filters));
          await env.DB.prepare('DELETE FROM searches WHERE user_id=? AND id=?').bind(id,value).run();
          return await savedSearches(env,user);
        }
        case 'delete':
          await env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();
          return await send(env,id,t.deleted);
      }
      return await menu(env,user);
    }
    if (text === '/delete_me') return await send(env,id,t.deleteConfirm,[[callback(t.confirm,'delete'),callback(t.cancel,'menu')]]);
    if (text === '/help') return await send(env,id,`${t.criteria}\n${Object.keys(filtersSchema.shape).join(', ')}\n/delete_me\n/qualification`);
    if (text.startsWith('/qualification')) {
      const value = text.slice('/qualification'.length).trim();
      const parsed = filtersSchema.safeParse({qualification:value});
      if (!parsed.success) return await send(env,id,t.qualification);
      await env.DB.prepare('UPDATE users SET qualification=? WHERE id=?').bind(parsed.data.qualification,id).run();
      return await send(env,id,t.savedOk,[[callback(t.match,'match')]]);
    }
    if (text.startsWith('/start j_')) {
      const job = await byPrefix(env,text.slice(9));
      if (job && isActive(job)) return await jobCard(env,user,job);
      return await send(env,id,t.expired);
    }
    if (text && !text.startsWith('/')) {
      let parsed:Filters;
      try { parsed = parseTextFilters(text); } catch { return await send(env,id,t.invalid); }
      return await setFilters(env,user,parsed);
    }
    return await menu(env,user);
  } catch (error) {
    // Keep the update claimed when deletion already committed, including a failed confirmation delivery.
    if (query?.data !== 'delete') await env.DB.prepare('DELETE FROM updates WHERE id=?').bind(update.update_id).run();
    throw error;
  }
}
async function byPrefix(env:Env,prefix:string) {
  if (!/^[0-9a-f]{60}$/.test(prefix)) return null;
  const rows = await env.DB.prepare("SELECT id FROM jobs WHERE id GLOB ? LIMIT 2").bind(`${prefix}*`).all<{id:string}>();
  return rows.results.length===1 ? lookup(env.DB,rows.results[0].id) : null;
}
async function savedSearches(env:Env,user:User) {
  const t = dictionary[user.language];
  const {results} = await env.DB.prepare('SELECT id,filters,cadence FROM searches WHERE user_id=? ORDER BY id DESC').bind(user.id)
    .all<{id:number;filters:string;cadence:'off'|'daily'|'instant'}>();
  return send(env,user.id,results.length ? t.searches : t.alertEmpty,[
    ...results.map(row=>[
      callback(`${t[row.cadence]} · ${Object.entries(JSON.parse(row.filters)).map(([key,value])=>`${key}=${value}`).join(' · ').slice(0,38) || t.latest}`,`open:${row.id}`),
      callback(t.remove,`drop:${row.id}`)
    ]),[callback(t.menu,'menu')]
  ]);
}
export function sendAlert(env:Env,user:{id:string;language:Language},jobs:Listing[]) {
  const t = dictionary[user.language];
  return send(env,user.id,t.alert,jobs.map(job=>[
    link(job.title.slice(0,60),deepLink(env,`j_${job.id.slice(0,60)}`) ?? job.applicationUrl ?? job.officialSourceUrl)
  ]));
}
