import { publishApproved } from './channel';
import { refreshFeeds } from './feeds';
import { activeSql, search, stats, type Env } from './store';
import { sendAlert, TelegramError } from './telegram';

type Due = {id:number;user_id:string;language:'en'|'bn';filters:string;cadence:'daily'|'instant';cursor_time:string;cursor_id:string;due:number};
export async function deliverAlerts(env:Env,scheduleTime:number) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const db=env.DB;
  const {results} = await db.prepare(`SELECT searches.*,users.language FROM searches JOIN users ON users.id=user_id
    WHERE cadence<>'off' AND due<=? ORDER BY due,searches.id LIMIT 30`).bind(scheduleTime).all<Due>();
  for (const row of results) {
    const lease = Date.now()+300000;
    const claim = await db.prepare('UPDATE searches SET due=? WHERE id=? AND due=? AND cadence=?')
      .bind(lease,row.id,row.due,row.cadence).run();
    if (!claim.meta.changes) continue;
    const next = row.cadence==='daily' ? scheduleTime+86400000 : scheduleTime+60000;
    try {
      const jobs=await search(db,JSON.parse(row.filters),{cursor:[row.cursor_time,row.cursor_id],ascending:true,limit:10});
      if (jobs.length) await sendAlert(env,{id:row.user_id,language:row.language},jobs);
      const last=jobs.at(-1);
      await db.prepare('UPDATE searches SET due=?,cursor_time=?,cursor_id=? WHERE id=? AND due=? AND cadence=?')
        .bind(next,last?.visibleAt??row.cursor_time,last?.id??row.cursor_id,row.id,lease,row.cadence).run();
    } catch (error) {
      if (error instanceof TelegramError && error.code===403) {
        await db.prepare("UPDATE searches SET cadence='off' WHERE user_id=?").bind(row.user_id).run();
      }
      if (error instanceof TelegramError && error.code===429) {
        await db.prepare('UPDATE searches SET due=? WHERE id=? AND due=?')
          .bind(Math.max(lease,Date.now()+(error.retryAfter??60)*1000),row.id,lease).run();
        break;
      }
    }
  }
}
export async function scheduled(env:Env,cron:string,time:number) {
  if (cron==='* * * * *') {
    await Promise.all([deliverAlerts(env,time),publishApproved(env)]);
    return;
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE jobs SET payload=json_set(payload,'$.status','expired'),actor='cron',version=version+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='active' AND deadline<=strftime('%Y-%m-%dT%H:%M:%fZ','now')`),
    env.DB.prepare("DELETE FROM updates WHERE created_at<datetime('now','-7 days')"),
    env.DB.prepare("DELETE FROM receipts WHERE created_at<datetime('now','-30 days')")
  ]);
  await refreshFeeds(env);
  const day=new Date(time).toISOString().slice(0,10);
  const data=await stats(env.DB);
  const active=await env.DB.prepare(`SELECT count(*) AS count FROM jobs WHERE ${activeSql}`).first('count');
  await env.DB.prepare(`INSERT INTO operational_reports(day,payload) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET payload=excluded.payload`)
    .bind(day,JSON.stringify({active,jobs:data.jobs,totals:data.totals,sources:data.sources})).run();
}
