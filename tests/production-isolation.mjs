import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const base = 'https://tenderproject-two.vercel.app/api/sessions';
const env = process.env;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const users = [];
const sessionId = 'tk_' + randomUUID().replaceAll('-', '').slice(0, 12);
try {
  for (let i = 0; i < 2; i++) {
    const email = 'qa-' + randomUUID() + '@example.com';
    const password = randomUUID() + '!Aa';
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const user = { id: created.data.user.id };
    users.push(user);
    const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
    const login = await client.auth.signInWithPassword({ email, password });
    assert.ifError(login.error);
    user.token = login.data.session.access_token;
  }
  const sample = await (await fetch(base + '/sample', { method: 'POST' })).json();
  const state = { ...sample.session, sessionId, mode: 'LIVE' };
  const table = admin.from('bid_session_snapshots');
  assert.ifError((await table.insert({session_id:sessionId, owner_id:users[0].id, revision:state.revision, state})).error);
  const url = base + '/' + sessionId;
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+users[0].token}})).status,200);
  for (const [method,path] of [['GET',''],['GET','/report'],['POST','/chat'],['POST','/decision'],['POST','/correct'],['POST','/automate'],['DELETE','']]) {
    for (const [headers,expected] of [[{Authorization:'Bearer '+users[1].token},404],[{},401]]) {
      assert.equal((await fetch(url + path,{method,headers})).status,expected);
    }
    console.log(method, path || '/', 'foreign 404; anonymous 401');
  }
} finally {
  await admin.from('bid_session_snapshots').delete().eq('session_id',sessionId);
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
}
