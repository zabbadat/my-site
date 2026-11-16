// Emulator check of the squats/{id} rules. Needs @firebase/rules-unit-testing + firebase + Java; run from a scratch dir:
// firebase emulators:exec --only firestore --project demo-zab "node <repo>/test/rules-emulator/squats.rules.mjs" (port 8085)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import fs from 'fs';
const env = await initializeTestEnvironment({ projectId: 'demo-zab', firestore: { rules: fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 } });
const A = env.authenticatedContext('a').firestore(), B = env.authenticatedContext('b').firestore(), U = env.unauthenticatedContext().firestore();
let ok = 0, bad = 0; const t = async (n, p) => { try { await p; ok++; console.log('PASS', n); } catch (e) { bad++; console.log('FAIL', n, String(e.message).slice(0, 200)); } };
const now = Date.now();
const set = (o) => ({ name: 'Ann', xHandle: '@ann', uid: 'a', reps: 25, ms: 400000, source: 'camera', sessionStartedAt: now - 500000, createdAt: serverTimestamp(), ...o });
await t('owner camera set ok', assertSucceeds(setDoc(doc(A, 'squats/s1'), set())));
await t('addDoc ok (page path)', assertSucceeds(addDoc(collection(A, 'squats'), set({ reps: 10, ms: 130000 }))));
await t('signed-out create denied', assertFails(setDoc(doc(U, 'squats/s2'), set())));
await t('someone else\'s uid denied', assertFails(setDoc(doc(B, 'squats/s3'), set())));
await t('1001 reps denied', assertFails(setDoc(doc(A, 'squats/s4'), set({ reps: 1001, ms: 3000000, sessionStartedAt: now - 3100000 }))));
await t('1000 reps in 12 min ok', assertSucceeds(setDoc(doc(A, 'squats/s5'), set({ reps: 1000, ms: 700000, sessionStartedAt: now - 800000 }))));
await t('too fast (100 reps in 30 s) denied', assertFails(setDoc(doc(A, 'squats/s6'), set({ reps: 100, ms: 30000 }))));
await t('negative reps denied', assertFails(setDoc(doc(A, 'squats/s7'), set({ reps: -1 }))));
await t('fractional reps denied', assertFails(setDoc(doc(A, 'squats/s8'), set({ reps: 2.5 }))));
await t('non-camera source denied', assertFails(setDoc(doc(A, 'squats/s9'), set({ source: 'typed' }))));
await t('extra field (zab) denied', assertFails(setDoc(doc(A, 'squats/s10'), set({ zab: 100 }))));
await t('missing sessionStartedAt denied', assertFails(setDoc(doc(A, 'squats/s11'), (({ sessionStartedAt, ...r }) => r)(set()))));
await t('set longer than the camera session denied', assertFails(setDoc(doc(A, 'squats/s12'), set({ ms: 400000, sessionStartedAt: now - 100000 }))));
await t('set over 3 h denied', assertFails(setDoc(doc(A, 'squats/s13'), set({ ms: 10800001, sessionStartedAt: now - 11000000 }))));
await t('client createdAt denied', assertFails(setDoc(doc(A, 'squats/s14'), set({ createdAt: new Date() }))));
await t('long name denied', assertFails(setDoc(doc(A, 'squats/s15'), set({ name: 'x'.repeat(41) }))));
await t('update denied', assertFails(updateDoc(doc(A, 'squats/s1'), { reps: 999 })));
await t('delete denied', assertFails(deleteDoc(doc(A, 'squats/s1'))));
await t('signed-in read ok', assertSucceeds(getDoc(doc(B, 'squats/s1'))));
await t('signed-out read denied', assertFails(getDoc(doc(U, 'squats/s1'))));
// neighbours unchanged
await t('pushups create still ok', assertSucceeds(setDoc(doc(A, 'pushups/p1'), { name: 'Ann', uid: 'a', reps: 10, ms: 30000, createdAt: serverTimestamp() })));
await t('planks create still ok', assertSucceeds(setDoc(doc(A, 'planks/k1'), { name: 'Ann', uid: 'a', ms: 65000, holdSec: 65, source: 'camera', sessionStartedAt: now - 70000, createdAt: serverTimestamp() })));
console.log(`\n${ok} passed, ${bad} failed`); await env.cleanup(); process.exit(bad ? 1 : 0);
