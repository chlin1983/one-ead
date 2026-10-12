'use strict';
// Loaded into DeepTutor's Next.js server via NODE_OPTIONS (see _serve.py). It leaves the upstream
// bundle untouched and only adds one <script> to HTML pages, so it survives upstream updates.
const http = require('http');
const fs = require('fs');
const path = require('path');

const SCRIPT_URL = '/_one-ead/kb-rename.js';
const SCRIPT_FILE = path.join(__dirname, 'kb_rename.js');
const TAG = Buffer.from(`<script src="${SCRIPT_URL}" defer></script>`);
const HEAD_END = Buffer.from('</head>');

function serveScript(res) {
  try {
    const body = fs.readFileSync(SCRIPT_FILE);
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
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
  let done = false;
  const { write, end, writeHead, setHeader } = res;

  const patch = (chunk, enc) => {
    if (done || chunk == null || typeof chunk === 'function') return chunk;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8');
    const at = buf.indexOf(HEAD_END);
    if (at < 0) return chunk;
    done = true;
    return Buffer.concat([buf.subarray(0, at), TAG, buf.subarray(at)]);
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
    if (url === SCRIPT_URL) {
      serveScript(res);
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
