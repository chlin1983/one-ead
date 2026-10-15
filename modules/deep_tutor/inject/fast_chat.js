/**
 * One EAD - Fast Chat & Responsive Sidebar Accelerator
 *
 * Eliminates loading delays and the "Loading conversation..." spinner by:
 * 1. Predictive prefetching of sessions when hovering over sidebar items.
 * 2. Instant-response client-side SWR memory cache for /api/sessions and /api/sessions/{id}.
 * 3. Pre-warming the top 5 recent conversations during idle cycles.
 * 4. Microtask resolution so React 18 batches state transitions without rendering loading spinners.
 */
(() => {
  'use strict';
  if (window.__oneEadFastChat) return;
  window.__oneEadFastChat = true;

  const CACHE_TTL_MS = 60000; // 60 seconds memory cache
  const STALE_TTL_MS = 3000;  // 3 seconds before background revalidation
  const sessionCache = new Map(); // sid -> { json, data, time, inflight }
  const listCache = new Map();    // url -> { json, data, time }

  const origFetch = window.fetch;

  function prefetchSession(sid) {
    if (!sid || sid === 'new' || sid === 'draft') return;
    const hit = sessionCache.get(sid);
    if (hit && (Date.now() - hit.time < STALE_TTL_MS || hit.inflight)) return;

    const url = `/api/sessions/${encodeURIComponent(sid)}`;
    const inflight = origFetch(url, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.text();
        const data = JSON.parse(json);
        sessionCache.set(sid, { json, data, time: Date.now(), inflight: null });
        return data;
      })
      .catch(() => {
        if (sessionCache.get(sid)?.inflight === inflight) {
          sessionCache.delete(sid);
        }
      });

    sessionCache.set(sid, {
      json: hit ? hit.json : null,
      data: hit ? hit.data : null,
      time: hit ? hit.time : 0,
      inflight,
    });
  }

  // Hook window.fetch to return cached responses synchronously/in a microtask
  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
    const url = rawUrl.replace(/^(?:https?:\/\/[^/]+)?/, '');
    const method = (init && init.method ? init.method : (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Cache invalidation on mutations
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT') {
      if (url.includes('/api/sessions')) {
        const m = url.match(/\/api\/sessions\/([^/?#]+)/);
        if (m && m[1]) sessionCache.delete(decodeURIComponent(m[1]));
        listCache.clear();
      }
      return origFetch.apply(this, arguments);
    }

    if (method === 'GET') {
      // 1. Session detail: /api/sessions/{session_id}
      const sessMatch = url.match(/\/api\/sessions\/([^/?#]+)(?:\?|$)/);
      if (
        sessMatch &&
        sessMatch[1] &&
        !url.includes('/messages/') &&
        !url.includes('/ask-hint') &&
        !url.includes('/quiz-results') &&
        !url.includes('/organization') &&
        !url.includes('/search') &&
        !url.includes('/recycle-bin')
      ) {
        const sid = decodeURIComponent(sessMatch[1]);
        const hit = sessionCache.get(sid);

        if (hit && hit.json && Date.now() - hit.time < CACHE_TTL_MS) {
          // Revalidate in background if stale
          if (Date.now() - hit.time > STALE_TTL_MS) {
            prefetchSession(sid);
          }
          return new Response(hit.json, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-One-EAD-Fast': 'hit',
            },
          });
        }

        if (hit && hit.inflight) {
          try {
            await hit.inflight;
            const fresh = sessionCache.get(sid);
            if (fresh && fresh.json) {
              return new Response(fresh.json, {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'X-One-EAD-Fast': 'prefetched',
                },
              });
            }
          } catch (_) {}
        }
      }

      // 2. Session list: /api/sessions
      if (url.match(/\/api\/sessions(?:\?|$)/) && !url.includes('/search') && !url.includes('/recycle-bin')) {
        const hit = listCache.get(url);
        if (hit && Date.now() - hit.time < 5000) {
          return new Response(hit.json, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-One-EAD-Fast': 'list-hit',
            },
          });
        }
      }
    }

    const res = await origFetch.apply(this, arguments);

    // Save successful GET responses to cache
    if (res.ok && method === 'GET') {
      const sessMatch = url.match(/\/api\/sessions\/([^/?#]+)(?:\?|$)/);
      if (
        sessMatch &&
        sessMatch[1] &&
        !url.includes('/messages/') &&
        !url.includes('/ask-hint') &&
        !url.includes('/quiz-results') &&
        !url.includes('/organization') &&
        !url.includes('/search') &&
        !url.includes('/recycle-bin')
      ) {
        const sid = decodeURIComponent(sessMatch[1]);
        res.clone().text().then((json) => {
          try {
            sessionCache.set(sid, { json, data: JSON.parse(json), time: Date.now(), inflight: null });
          } catch (_) {}
        });
      } else if (url.match(/\/api\/sessions(?:\?|$)/) && !url.includes('/search') && !url.includes('/recycle-bin')) {
        res.clone().text().then((json) => {
          try {
            listCache.set(url, { json, data: JSON.parse(json), time: Date.now() });
            const list = JSON.parse(json);
            const sessions = (list && list.sessions) || [];
            // Pre-warm the top 5 most recent sessions during idle cycles
            const scheduleWarm = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
            scheduleWarm(() => {
              for (const s of sessions.slice(0, 5)) {
                if (s && s.id) prefetchSession(s.id);
              }
            });
          } catch (_) {}
        });
      }
    }

    return res;
  };

  // Hover & interaction prefetching for sidebar items
  function onPointer(e) {
    const el = e.target && e.target.closest && (e.target.closest('a[href*="/chat/"]') || e.target.closest('[data-session-id]'));
    if (!el) return;
    let sid = el.getAttribute('data-session-id');
    if (!sid) {
      const href = el.getAttribute('href') || '';
      const m = href.match(/\/chat\/([^/?#]+)/);
      if (m && m[1]) sid = decodeURIComponent(m[1]);
    }
    if (sid) prefetchSession(sid);
  }

  document.addEventListener('pointerenter', onPointer, { capture: true, passive: true });
  document.addEventListener('touchstart', onPointer, { capture: true, passive: true });
  document.addEventListener('focusin', onPointer, { capture: true, passive: true });
})();
