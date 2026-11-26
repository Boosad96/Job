import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canonicalUrl, constantTime, filtersSchema, jobSchema, normalize } from '../src/model';
import { parseTextFilters } from '../src/telegram';

const job={title:'  Systems Engineer ',company:'Test organization',officialSourceUrl:'https://example.test/job/1',sourceName:'Unit fixture'};

test('normalizes known fields, preserves zero and false, and records missing facts as null',()=>{
  const normalized=normalize(jobSchema.parse({...job,country:'gb',remote:false,experience:0,skills:['SQL','SQL']}));
  assert.equal(normalized.title,'Systems Engineer');
  assert.equal(normalized.country,'GB');
  assert.equal(normalized.remote,false);
  assert.equal(normalized.experience,0);
  assert.equal(normalized.city,null);
  assert.deepEqual(normalized.skills,['SQL']);
});
test('rejects invalid ranges, dates, countries, credentials in URLs and unknown fields',()=>{
  for (const invalid of [
    {minSalary:10,maxSalary:9},{country:'ZZ'},{applicationDeadline:'2026-01-01'},
    {officialSourceUrl:'https://name:pass@example.test/job'},
    {verifiedAt:'2999-01-01T00:00:00Z'},{unexpected:true}
  ]) assert.equal(jobSchema.safeParse({...job,...invalid}).success,false);
  assert.equal(normalize(jobSchema.parse({...job,applicationDeadline:'2020-01-01T00:00:00+05:30'})).status,'expired');
});
test('canonical URLs remove tracking without losing job identifiers',()=>{
  assert.equal(canonicalUrl('https://example.test/jobs/?utm_medium=cpc&b=2&a=1#detail'),'https://example.test/jobs?a=1&b=2');
  assert.equal(constantTime('secret','secret'),true);
  assert.equal(constantTime('secret','different'),false);
});
test('Telegram filters use the public filter validator',()=>{
  assert.deepEqual(parseTextFilters('country=in | skills=Excel, SQL | experience=0 | remote=false'),{
    country:'IN',skills:'Excel, SQL',experience:0,remote:false
  });
  assert.deepEqual(parseTextFilters('কলকাতা'),{q:'কলকাতা'});
  assert.throws(()=>parseTextFilters('salary=4000'));
  assert.equal(filtersSchema.safeParse({minSalary:'100'}).success,false);
  assert.equal(filtersSchema.safeParse({skills:'Excel, ,SQL'}).success,false);
});
