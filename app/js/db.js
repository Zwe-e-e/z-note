/* Z Note · IndexedDB wrapper (pages, image blobs, settings) */
(function () {
  'use strict';
  const ZN = window.ZN;
  const NAME = 'znote', VERSION = 1;
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let rq;
      try { rq = indexedDB.open(NAME, VERSION); } catch (e) { reject(e); return; }
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      rq.onsuccess = () => {
        const db = rq.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      rq.onerror = () => reject(rq.error);
      rq.onblocked = () => reject(new Error('The notebook is locked by another Z Note window.'));
    });
    return opening;
  }

  /* run fn(objectStore[, transaction]) and resolve with the request result once the transaction commits */
  function tx(stores, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let rq;
      try { rq = fn(Array.isArray(stores) ? t : t.objectStore(stores), t); }
      catch (e) { reject(e); try { t.abort(); } catch (e2) {} return; }
      t.oncomplete = () => resolve(rq && typeof rq === 'object' && 'result' in rq ? rq.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
    }));
  }

  ZN.db = {
    open,
    all: store => tx(store, 'readonly', s => s.getAll()),
    get: (store, key) => tx(store, 'readonly', s => s.get(key)),
    put: (store, val, key) => tx(store, 'readwrite', s => (key === undefined ? s.put(val) : s.put(val, key))),
    del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
    clear: store => tx(store, 'readwrite', s => s.clear()),
    /* write and delete several records in one transaction */
    batch: (store, puts, dels) => tx(store, 'readwrite', s => {
      (puts || []).forEach(v => s.put(v));
      (dels || []).forEach(k => s.delete(k));
    })
  };
})();
