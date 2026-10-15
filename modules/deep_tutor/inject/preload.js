'use strict';
// Loaded into DeepTutor's Next.js server via NODE_OPTIONS (see _serve.py). It leaves the upstream
// bundle untouched and only adds <script> tags to HTML pages, so it survives upstream updates.
const http = require('http');
const fs = require('fs');
const path = require('path');

const SCRIPTS = {
  '/_one-ead/fast-chat.js': path.join(__dirname, 'fast_chat.js'),
  '/_one-ead/kb-rename.js': path.join(__dirname, 'kb_rename.js'),
  '/_one-ead/chat-sources.js': path.join(__dirname, 'chat_sources.js'),
};
// Standalone page for the side pane; it must not get the SCRIPTS tags injected.
const VIEWER_URL = '/_one-ead/page-view';
const VIEWER_FILE = path.join(__dirname, 'page_view.html');
const TAG = Buffer.from(Object.keys(SCRIPTS).map((url) => `<script src="${url}" defer></script>`).join(''));
const HEAD_END = Buffer.from('</head>');
// DeepTutor reopens the side panel on load if it was left open; this must run before the app scripts.
const HEAD_START = Buffer.from('<head>');
const CLOSE_PANEL = Buffer.from("<script>try{localStorage.setItem('dt:chat:viewer-panel','0')}catch(e){}</script>");

function serveFile(res, file, type) {
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404);
    res.end();
  }
}

function injectIntoHtml(res) {
  let startDone = false;
  let endDone = false;
  const { write, end, writeHead, setHeader } = res;

  const patch = (chunk, enc) => {
    if ((startDone && endDone) || chunk == null || typeof chunk === 'function') return chunk;
    let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8');
    let changed = false;
    if (!startDone) {
      const at = buf.indexOf(HEAD_START);
      if (at >= 0) {
        startDone = true;
        changed = true;
        const cut = at + HEAD_START.length;
        buf = Buffer.concat([buf.subarray(0, cut), CLOSE_PANEL, buf.subarray(cut)]);
      }
    }
    if (!endDone) {
      const at = buf.indexOf(HEAD_END);
      if (at >= 0) {
        endDone = true;
        changed = true;
        buf = Buffer.concat([buf.subarray(0, at), TAG, buf.subarray(at)]);
      }
    }
    return changed ? buf : chunk;
  };
  const wrap = (fn) =>
    function () {
      const args = Array.from(arguments);
      const out = patch(args[0], args[1]);
      if (out !== args[0]) {
        args[0] = out;
        if (typeof args[1] === 'string') args.splice(1, 1);
      }
      return fn.apply(this, args);
    };

  res.write = wrap(write);
  res.end = wrap(end);
  // The body grows, so a fixed Content-Length from upstream would truncate it.
  res.setHeader = function (name, value) {
    const key = String(name).toLowerCase();
    if (['content-length', 'etag', 'cache-control'].includes(key)) return this;
    return setHeader.call(this, name, value);
  };
  res.writeHead = function () {
    const args = Array.from(arguments);
    for (const a of args) {
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        for (const k of Object.keys(a)) if (['content-length', 'etag', 'cache-control'].includes(k.toLowerCase())) delete a[k];
      }
    }
    this.removeHeader('content-length');
    this.removeHeader('etag');
    return writeHead.apply(this, args);
  };
  setHeader.call(res, 'Cache-Control', 'no-cache');
}

const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res) {
  if (event === 'request' && req && res) {
    const url = String(req.url || '').split('?')[0];
    if (Object.prototype.hasOwnProperty.call(SCRIPTS, url)) {
      serveFile(res, SCRIPTS[url], 'application/javascript; charset=utf-8');
      return true;
    }
    if (url === VIEWER_URL) {
      serveFile(res, VIEWER_FILE, 'text/html; charset=utf-8');
      return true;
    }
    if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
      // Compressed bytes can't be searched for </head>; a 304 would make the browser reuse an un-injected copy.
      delete req.headers['accept-encoding'];
      delete req.headers['if-none-match'];
      delete req.headers['if-modified-since'];
      injectIntoHtml(res);
    }
  }
  return originalEmit.apply(this, arguments);
};
