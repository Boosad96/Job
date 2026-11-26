import { Conflict, isActive, lookup, type Env } from './store';
import { telegram, TelegramError } from './telegram';
import type { Listing } from './model';

export type Publication = {job_id:string; state:string; text:string; job_version:number; message_id:number|null};
export function eligible(job:Listing) {
  return isActive(job) && job.country==='IN' && job.state?.toLowerCase()==='west bengal' &&
    job.category==='government' && !!job.verifiedAt;
}
export async function publication(env:Env,id:string) {
  return env.DB.prepare('SELECT * FROM publications WHERE job_id=?').bind(id).first<Publication>();
}
export async function managePublication(env:Env,input:{jobId:string;action:'request'|'approve'|'reject';text?:string},actor:string) {
  const current = await publication(env,input.jobId);
  if (current && ['sending','published'].includes(current.state)) return current;
  const job = await lookup(env.DB,input.jobId);
  if (!job) return null;
  const db = env.DB;
  let statement:D1PreparedStatement;
  if (input.action==='request') {
    if (!eligible(job)) throw new Conflict('Job must be an active, verified West Bengal government job');
    if (!input.text || !/[\u0985-\u09B9]/.test(input.text)) throw new Conflict('Publication text must be Bengali');
    const state = env.CHANNEL_AUTO_PUBLISH==='true' ? 'approved' : 'pending';
    statement = db.prepare(`INSERT INTO publications(job_id,state,text,job_version)
      SELECT id,?,?,version FROM jobs WHERE id=? AND version=?
      ON CONFLICT(job_id) DO UPDATE SET state=excluded.state,text=excluded.text,job_version=excluded.job_version,updated_at=CURRENT_TIMESTAMP
      WHERE publications.state NOT IN ('sending','published')
        AND (publications.job_version<>excluded.job_version OR publications.text<>excluded.text)
        AND (publications.state<>'rejected' OR publications.job_version<>excluded.job_version)`)
      .bind(state,input.text,job.id,job.version);
  } else {
    if (!current) return null;
    if (input.action==='approve' && (!eligible(job) || current.job_version!==job.version)) throw new Conflict('Request must match the current verified job revision');
    statement = db.prepare(`UPDATE publications SET state=?,updated_at=CURRENT_TIMESTAMP
      WHERE job_id=? AND job_version=? AND text=? AND state IN ('pending','approved','rejected') AND state<>?`)
      .bind(input.action==='approve' ? 'approved' : 'rejected',job.id,current.job_version,current.text,input.action==='approve' ? 'approved' : 'rejected');
  }
  await db.batch([statement,db.prepare('INSERT INTO audit(actor,action,subject) SELECT ?,?,? WHERE changes()>0')
    .bind(actor,`channel.${input.action}`,job.id)]);
  return publication(env,job.id);
}
export async function publishApproved(env:Env) {
  if (!env.CHANNEL_CHAT_ID || !env.TELEGRAM_BOT_TOKEN) return;
  const {results} = await env.DB.prepare("SELECT * FROM publications WHERE state='approved' ORDER BY updated_at LIMIT 10").all<Publication>();
  for (const row of results) {
    const job = await lookup(env.DB,row.job_id);
    if (!job || !eligible(job) || job.version!==row.job_version) {
      await env.DB.batch([
        env.DB.prepare("UPDATE publications SET state='rejected',updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND state='approved' AND job_version=?")
          .bind(row.job_id,row.job_version),
        env.DB.prepare("INSERT INTO audit(actor,action,subject) SELECT 'cron','channel.stale',? WHERE changes()>0").bind(row.job_id)
      ]);
      continue;
    }
    const claim = await env.DB.prepare(`UPDATE publications SET state='sending',updated_at=CURRENT_TIMESTAMP
      WHERE job_id=? AND state='approved' AND job_version=? AND text=?
        AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND version=? AND status='active' AND (deadline IS NULL OR deadline>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
      .bind(job.id,job.version,row.text,job.id,job.version).run();
    if (!claim.meta.changes) continue;
    try {
      const message = await telegram<{message_id:number}>(env,'sendMessage',{
        chat_id:env.CHANNEL_CHAT_ID,text:`${row.text}\n\n${job.officialSourceUrl}`,
        link_preview_options:{is_disabled:true}
      });
      await env.DB.batch([
        env.DB.prepare("UPDATE publications SET state='published',message_id=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=?").bind(message.message_id,job.id),
        env.DB.prepare("INSERT INTO audit(actor,action,subject) VALUES('cron','channel.published',?)").bind(job.id)
      ]);
    } catch (error) {
      // A transport failure may have delivered the message. Keep the claim for manual reconciliation.
      const state = error instanceof TelegramError && error.code === 429 ? 'approved'
        : error instanceof TelegramError && [400,401,403,404].includes(error.code) ? 'pending' : 'sending';
      await env.DB.batch([
        env.DB.prepare('UPDATE publications SET state=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND state=\'sending\'').bind(state,job.id),
        env.DB.prepare('INSERT INTO audit(actor,action,subject) VALUES(?,?,?)').bind('cron',`channel.delivery.${state}`,job.id)
      ]);
      if (error instanceof TelegramError && error.code===429) break;
    }
  }
}
