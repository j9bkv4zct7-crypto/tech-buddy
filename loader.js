// Tech Buddy lock screen + loader. The app itself is shipped only as AES-GCM ciphertext (app.bin). An access code
// derives a key (PBKDF2-SHA256, per-code salt) that unwraps the app key; the app is decrypted and started in memory.
// Nothing secret is stored: the key lives only in this page, so closing, reloading or 5+ minutes in the background relocks.
(() => {
  'use strict';
  const LOCK_AFTER_MS = 5 * 60 * 1000;
  const $ = id => document.getElementById(id);
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const input = $('tbCode'), msg = $('tbMsg'), go = $('tbUnlock');
  let unlocked = false, busy = false, hiddenAt = 0, deferredInstall = null;

  addEventListener('beforeinstallprompt', e => { if (!unlocked) { e.preventDefault(); deferredInstall = e; } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---- keypad ----
  $('tbPad').addEventListener('click', e => {
    const k = e.target.closest('button')?.dataset.k; if (!k || busy) return;
    if (k === 'clear') input.value = ''; else if (k === 'back') input.value = input.value.slice(0, -1);
    else if (input.value.length < 8) input.value += k;
    msg.textContent = '';
  });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 8); msg.textContent = ''; });
  if (matchMedia('(pointer: fine)').matches) input.focus();

  // ---- slow down repeated wrong tries (the real protection is the key derivation) ----
  const getF = () => { try { return JSON.parse(localStorage.getItem('tbLockTries')) || { n: 0, t: 0 }; } catch { return { n: 0, t: 0 }; } };
  const setF = f => { try { localStorage.setItem('tbLockTries', JSON.stringify(f)); } catch {} };
  const waitLeft = () => { const f = getF(); if (f.n < 3) return 0; return Math.max(0, f.t + Math.min(60, 2 ** (f.n - 3) * 2) * 1000 - Date.now()); };

  async function unwrap(code){
    const meta = await (await fetch('keys.json')).json();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    const tries = meta.keys.map(async k => {
      const wk = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(k.s), iterations: meta.it }, base, { name: 'AES-GCM', length: 256 }, false, ['unwrapKey']);
      return crypto.subtle.unwrapKey('raw', b64(k.w), wk, { name: 'AES-GCM', iv: b64(k.i) }, { name: 'AES-GCM' }, false, ['decrypt']);
    });
    const hit = (await Promise.allSettled(tries)).find(r => r.status === 'fulfilled');
    return hit ? { key: hit.value, meta } : null;
  }

  async function decryptApp(key, meta){
    const bin = new Uint8Array(await (await fetch('app.bin')).arrayBuffer());
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bin.slice(0, 12), additionalData: new TextEncoder().encode(meta.b) }, key, bin.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function boot(bundle){
    const base = document.baseURI, abs = p => new URL(p, base).href, files = bundle.files;
    globalThis.__tbURL = abs;
    // data files (e.g. the procedure library) are served from memory to the app's own fetch() calls
    const realFetch = window.fetch.bind(window);
    const data = new Map(Object.keys(files).filter(p => !/\.(js|html)$/.test(p)).map(p => [abs(p), p]));
    window.fetch = (res, init) => {
      try { const u = new URL(typeof res === 'string' || res instanceof URL ? String(res) : res.url, base); u.search = ''; u.hash = '';
        const p = data.get(u.href); if (p) return Promise.resolve(new Response(files[p].d, { headers: { 'content-type': files[p].t } })); } catch {}
      return realFetch(res, init);
    };
    // modules -> in-memory blob URLs, dependencies first (the build rewrote relative imports to __TBDEP:path__ markers)
    const urls = {};
    for (const p of bundle.order) urls[p] = URL.createObjectURL(new Blob([files[p].d.replace(/__TBDEP:([^'"]+?)__/g, (_, d) => urls[d]) + '\n//# sourceURL=' + abs(p)], { type: 'text/javascript' }));
    // page: the app's head styles and body
    const doc = new DOMParser().parseFromString(files[bundle.html].d, 'text/html');
    document.title = doc.title || 'Tech Buddy';
    for (const l of doc.querySelectorAll('link[rel=stylesheet]')) { const p = l.getAttribute('href'); if (files[p]) { const s = document.createElement('style'); s.textContent = files[p].d; document.head.appendChild(s); } }
    doc.querySelectorAll('script').forEach(s => s.remove());
    $('tbLockCss')?.remove();
    document.body.className = doc.body.className; document.body.innerHTML = doc.body.innerHTML;
    const host = document.querySelector('.topbtns');
    const lb = document.createElement('button'); lb.id = 'btnLock'; lb.type = 'button'; lb.className = host ? 'btn small ghost tb-lockbtn' : 'tb-lockbtn'; lb.textContent = 'Lock'; lb.title = 'Lock Tech Buddy (the code is needed to open it again)';
    lb.onclick = lock; if (host) host.appendChild(lb); else { lb.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99'; document.body.appendChild(lb); }
    unlocked = true;
    await import(urls[bundle.entry]);
    if (deferredInstall) { try { window.dispatchEvent(deferredInstall); } catch {} }
  }

  function lock(){ unlocked = false; location.reload(); }
  document.addEventListener('visibilitychange', () => {
    if (!unlocked) return;
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lock();
  });
  addEventListener('pageshow', e => { if (e.persisted && unlocked) lock(); });

  $('tbForm').addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const code = input.value;
    const w = waitLeft(); if (w) { msg.textContent = `Too many tries. Wait ${Math.ceil(w / 1000)} s and try again.`; return; }
    if (!/^\d{8}$/.test(code)) { msg.textContent = 'Enter the 8-digit code.'; return; }
    busy = true; go.disabled = true; msg.textContent = 'Unlocking…';
    try {
      const r = await unwrap(code); input.value = '';
      if (!r) { const f = getF(); setF({ n: f.n + 1, t: Date.now() }); await new Promise(res => setTimeout(res, 400)); msg.textContent = "That code didn't work."; return; }
      setF({ n: 0, t: 0 });
      await boot(await decryptApp(r.key, r.meta));
    } catch (err) {
      msg.textContent = navigator.onLine === false ? 'Could not open the app offline yet - open it once with internet first.' : 'Could not open the app. Reload and try again.';
    } finally { busy = false; go.disabled = false; }
  });
})();
