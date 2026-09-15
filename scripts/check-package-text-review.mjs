import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeLineup } from './fixtures/lineups.mjs';
import { manifestSchema } from '../src/package-model.mjs';
import { createTextReviewer, assertPackageTextAllowed as reviewRemote, TEXT_REVIEW_RULES_URL, TEXT_REVIEW_TIMEOUT_MS } from '../src/package-text-review.mjs';
const wordList = JSON.parse(await readFile(new URL('../publishing/text-review-rules.json', import.meta.url), 'utf8'));
const textReviewRules = wordList.rules;
const { reviewText, reviewPackageText, assertPackageTextAllowed } = createTextReviewer(textReviewRules);

for (const rule of textReviewRules) {
  assert.equal(new Set(rule.terms).size, rule.terms.length, 'Rule entries are unique');
  for (const term of rule.terms) assert(reviewText(term).includes(rule.label), term);
}
for (const text of ['https://example.com', 'ｗｗｗ．example．com', 'example.dev/point', 'h t t p s : / /example.com', 'https://例子.中国', 'user@example.com', '[说明](/page)', '<a href="/page">说明</a>', '//localhost/path', '192.168.1.2/path', 'https://exa\u200bmple.com']) assert(reviewText(text).includes('链接'), text);
for (const text of ['习近平', '習近平', '习\u200b近 平', '中-共', 'Xi Jinping', '做 爱', '裸\u200b聊', '成 人 小 說', '中\u200b央 統 戰 部', 'ＴＳＡＩ　ＩＮＧ　ＷＥＮ', 'Sex-Chat']) assert(reviewText(text).length, text);
for (const text of ['北京玩家在上海服务器练习，台湾地图讨论', 'A点二段跳投，0.5 秒后释放', 'BV17x411w7KC', '射出侦查箭，向敌方方向跳跃', 'Scunthorpe player', '普通个人备忘录', '射击、爆破、闪光、烟雾、穿墙、卖身位', 'classic, phantom, vandal, marshal', '先站箱子旁，瞄准屋檐后跳投']) assert.deepEqual(reviewText(text), [], text);
const base = makeLineup();
const clean = { format:'valo-lineup-edit-package', version:4, packageId:crypto.randomUUID(), revision:1, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), author:base.uploader, changes:{added:[base],updated:[]},uploadedAssets:[] };
for (const version of [4,5,6]) assert.deepEqual(reviewPackageText(manifestSchema.parse({...clean,version})),[]);
const frozen = JSON.parse(await readFile(new URL('./fixtures/edit-package-v4.json', import.meta.url),'utf8'));
assert.deepEqual(reviewPackageText(frozen),[]);
assert.deepEqual(reviewPackageText({ ...clean, referencedAssets: [{ original: { key:'lineups/test-primary/old.png', sha256:'a'.repeat(64) } }] }), [], 'Image provenance paths are structural metadata');
assert.equal(reviewPackageText({ ...clean, 'changes.added.0.id':'https://example.com' }).length,1,'Extension names cannot impersonate structural paths');
const bad = structuredClone(clean);
bad.author.name='https://example.com';
bad.changes.added[0].title='成人网站';
bad.changes.added[0].area='习近平';
bad.changes.added[0].instructions='www.example.com';
bad.changes.added[0].uploader.name='裸聊';
bad.changes.added[0].media.stance=[{key:`lineups/${base.id}/shot.webp`,alt:'https://example.org'}];
bad.changes.updated=[{id:'test-update',before:{...base,instructions:'色情'},after:{...base,title:'普通新标题'}}];
bad.changes.deleted=[{id:base.id,before:{...base,instructions:'天安门事件'}}];
bad.uploadedAssets=[{key:'lineups/test-primary/shot.webp',alt:'pornography'}];
bad.referencedAssets=[{key:'lineups/test-primary/reference.webp',alt:'https://example.net'}];
bad.extension={note:'习近平'};
const snapshot=JSON.stringify(bad), issues=reviewPackageText(bad);
assert.equal(issues.length,11,'All prose fields, snapshots, asset descriptions and extension text are reviewed');
assert(issues.some(item=>item.path==='changes.updated.0.before.instructions'));
assert(issues.some(item=>item.path==='changes.deleted.0.before.instructions'));
for (const operation of ['导入','导出']) assert.throws(()=>assertPackageTextAllowed(bad,operation),error=>error.name==='PackageTextReviewError' && error.findings.length===11 && error.message.startsWith(operation) && !error.message.includes('https://example.com'));
assert.equal(JSON.stringify(bad),snapshot,'Review does not alter the package');
assert.doesNotThrow(()=>assertPackageTextAllowed(clean,'导出'));
assert.throws(()=>assertPackageTextAllowed(bad,'保存'),error=>error.name==='PackageTextReviewError' && error.findings.length===9 && error.message.startsWith('保存已中止'));
const correction={...clean,changes:{added:[],updated:[{id:base.id,before:{...base,instructions:'裸聊'},after:base}],deleted:[{id:'deleted',before:{...base,id:'deleted',title:'习近平'}}]}};
assert.doesNotThrow(()=>assertPackageTextAllowed(correction,'保存'),'Correcting and deleting old text can be saved');
for(const operation of ['导入','导出']) assert.throws(()=>assertPackageTextAllowed(correction,operation),'Exchange still reviews historical snapshots');
for(const version of [4,5,6]) assert.doesNotThrow(()=>assertPackageTextAllowed(manifestSchema.parse({...clean,version}),'保存'));
console.log('PASS text review: expanded rules, game vocabulary, links, snapshots, save corrections, v4/v5/v6 and immutable rejection');

const originalFetch = globalThis.fetch;
let requests = 0;
let remoteData = {version:1,rules:[{category:'sexual',label:'色情词项',terms:['外链测试词']}]};
const remotePoint = {...clean,changes:{added:[{...base,instructions:'外链测试词'}],updated:[]}};
try {
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url,TEXT_REVIEW_RULES_URL);
    assert.equal(options.cache,'no-store');
    assert.equal(options.credentials,'omit');
    assert.equal(options.body,undefined,'Only the dictionary is fetched; point data is never sent');
    return Response.json(remoteData);
  };
  for(const operation of ['保存','导入','导出']) await assert.rejects(reviewRemote(remotePoint,operation),error=>error.name==='PackageTextReviewError');
  remoteData={version:2,rules:[{category:'sexual',label:'色情词项',terms:['新外链词']}]};
  assert.deepEqual(await reviewRemote(remotePoint,'保存'),{textReviewWarning:''},'Removed remote terms stop matching on the next operation');
  await assert.rejects(reviewRemote({...remotePoint,author:{...base.uploader,name:'新外链词'}},'保存'));
  assert.equal(requests,5,'Each operation requests the current dictionary');
  const failures = [
    async()=>{throw new TypeError('Failed to fetch');},
    async()=>new Response('',{status:503}),
    async()=>new Response('{invalid json'),
    async()=>Response.json({version:1,rules:[{category:'sexual',label:'词项',terms:[42]}]}),
    async()=>Response.json({version:1,rules:[{category:'sexual',label:'词项',terms:['!!!']}]}),
  ];
  for(const fail of failures) {
    globalThis.fetch=fail;
    for(const operation of ['保存','导入','导出']) {
      assert.match((await reviewRemote(remotePoint,operation)).textReviewWarning,/词库加载失败/);
      await assert.rejects(reviewRemote({...remotePoint,author:{...base.uploader,name:'https://example.com'}},operation),error=>error.name==='PackageTextReviewError','Link detection remains active during dictionary outages');
    }
  }
  globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  const keepAlive=setTimeout(()=>{},TEXT_REVIEW_TIMEOUT_MS+1000);
  try { assert.match((await reviewRemote(remotePoint,'保存')).textReviewWarning,/词库加载失败/,'A stalled request times out and lets the operation continue'); }
  finally { clearTimeout(keepAlive); }
  globalThis.fetch=async()=>Response.json(wordList);
  assert.deepEqual(await reviewRemote(clean,'保存'),{textReviewWarning:''},'The next operation recovers after an outage');
  await assert.rejects(reviewRemote(bad,'保存'),error=>error.name==='PackageTextReviewError');
  assert.equal(JSON.stringify(bad),snapshot);
} finally { globalThis.fetch=originalFetch; }
console.log('PASS remote dictionary updates, all operation boundaries, timeout/network/HTTP/JSON failures, link-only checks and recovery');
