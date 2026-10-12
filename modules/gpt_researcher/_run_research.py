"""Runs one gpt-researcher job inside the plugin's private venv.

Usage: ``python _run_research.py <job_dir>``; reads ``job.json`` there, writes ``report.md`` and
``result.json`` (or ``error.json``). Stdlib only until the guard is installed, so nothing can
touch the network before it is in place.

Privacy model
  * local mode  : a Python-level network guard refuses every non-loopback connection and DNS
                  lookup, so documents and prompts cannot leave this PC even if a library tries.
  * web/hybrid  : the guard stays on a deny-list of cloud LLM / telemetry hosts; only the search
                  queries written by the local model and page fetches reach the internet.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import socket
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse

# Hosts that would receive prompts/documents or telemetry; blocked in every mode.
DENIED_HOST_PARTS = (
    "openai.com", "anthropic.com", "typesafe.ai", "smith.langchain.com", "langchain.com", "tavily.com",
    "posthog.com", "okahu.ai", "generativelanguage.googleapis.com",
    "groq.com", "mistral.ai", "cohere.com", "together.xyz", "fireworks.ai", "x.ai", "huggingface.co",
    "sentry.io", "segment.io", "mixpanel.com",
)
LOOPBACK_NAMES = {"localhost", "localhost.localdomain"}
# Minimum seconds between requests, one at a time, per public academic API (arXiv: 1 per 3 s, one connection).
API_INTERVALS = {
    "export.arxiv.org": 3.0,
    "api.semanticscholar.org": 5.0,  # unauthenticated access shares one pool and still returned 429 at 2 s
    "api.openalex.org": 1.0,
    "eutils.ncbi.nlm.nih.gov": 1.0,  # NCBI allows 3 requests/s without an API key
}
MAX_CRAWL_DELAY = 30.0


def _is_denied(host) -> bool:
    lowered = str(host or "").lower()
    return any(lowered == part or lowered.endswith("." + part) or lowered.endswith(part) for part in DENIED_HOST_PARTS)


def _host_of(address) -> str | None:
    if isinstance(address, (tuple, list)) and address:
        host = address[0]
        return host.decode() if isinstance(host, bytes) else host
    return None


def _is_loopback(host) -> bool:
    if host in (None, ""):
        return True
    if isinstance(host, bytes):
        host = host.decode("ascii", "ignore")
    if str(host).lower() in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(str(host).split("%")[0]).is_loopback
    except ValueError:
        return False


def install_network_guard(offline: bool) -> None:
    class Blocked(OSError):
        pass

    def check(host, what: str) -> None:
        if isinstance(host, bytes):
            host = host.decode("ascii", "ignore")
        if _is_loopback(host):
            return
        if offline:
            raise Blocked(f"Offline mode: blocked {what} to {host!r}")
        if _is_denied(host):
            raise Blocked(f"Blocked {what} to {host!r} (cloud AI / telemetry host)")

    real_getaddrinfo = socket.getaddrinfo
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_sendto = socket.socket.sendto

    def getaddrinfo(host, *args, **kwargs):
        check(host, "DNS lookup")
        return real_getaddrinfo(host, *args, **kwargs)

    def connect(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6):
            check(_host_of(address), "connection")
        return real_connect(self, address)

    def connect_ex(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6):
            check(_host_of(address), "connection")
        return real_connect_ex(self, address)

    def sendto(self, data, *args):
        if self.family in (socket.AF_INET, socket.AF_INET6) and args:
            check(_host_of(args[-1]), "datagram")
        return real_sendto(self, data, *args)

    def gethostbyname(host):
        check(host, "DNS lookup")
        return real_gethostbyname(host)

    def gethostbyname_ex(host):
        check(host, "DNS lookup")
        return real_gethostbyname_ex(host)

    real_gethostbyname = socket.gethostbyname
    real_gethostbyname_ex = socket.gethostbyname_ex
    socket.getaddrinfo = getaddrinfo
    socket.gethostbyname = gethostbyname
    socket.gethostbyname_ex = gethostbyname_ex
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.socket.sendto = sendto


def install_http_policy(user_agent: str) -> None:
    """Polite, safe HTTP for everything built on ``requests`` (retrievers and page scrapers).

    * academic APIs: one request at a time per host, with the minimum spacing in ``API_INTERVALS``
    * other sites: robots.txt is honoured (disallowed pages are skipped, Crawl-delay is obeyed)
    * cloud-AI/telemetry hosts are refused by URL (a corporate proxy hides them from the socket guard)
    * TLS verification can never be switched off (the engine falls back to verify=False on SSL errors)
    """
    import threading
    import urllib.robotparser as robotparser

    import requests
    import requests.adapters as adapters

    original = adapters.HTTPAdapter.send
    guard = threading.Lock()
    hosts: dict = {}  # host -> [lock, earliest next request]
    robots: dict = {}  # origin -> RobotFileParser

    def host_state(host):
        with guard:
            return hosts.setdefault(host, [threading.Lock(), 0.0])

    def load_robots(adapter, origin, kw):
        with guard:
            known = robots.get(origin)
        if known is not None:
            return known
        parser = robotparser.RobotFileParser()
        try:
            probe = requests.Request("GET", origin + "/robots.txt", headers={"User-Agent": user_agent}).prepare()
            reply = original(adapter, probe, **{**kw, "stream": False, "timeout": 10})
            if reply.status_code in (401, 403):
                parser.disallow_all = True
            elif reply.status_code == 200:
                parser.parse(reply.content[:512_000].decode("utf-8", "replace").splitlines())
            else:
                parser.allow_all = True
        except Exception:
            parser.allow_all = True
        with guard:
            robots[origin] = parser
        return parser

    def send(self, request, stream=False, timeout=None, verify=True, cert=None, proxies=None):
        url = urlparse(request.url)
        host = (url.hostname or "").lower()
        if _is_denied(host):
            raise adapters.ConnectionError(f"Blocked request to {host!r} (cloud AI / telemetry host)")
        if verify is False:
            raise adapters.SSLError("TLS certificate verification cannot be disabled")
        kw = {"stream": stream, "timeout": timeout, "verify": verify, "cert": cert, "proxies": proxies}
        if _is_loopback(host) or request.method not in ("GET", "HEAD"):
            return original(self, request, **kw)

        interval = API_INTERVALS.get(host)
        if interval is None and url.path != "/robots.txt":
            parser = load_robots(self, f"{url.scheme}://{url.netloc}", kw)
            if not parser.can_fetch(user_agent, request.url):
                raise adapters.ConnectionError(f"Skipped, disallowed by robots.txt: {request.url}")
            delay = parser.crawl_delay(user_agent)
            interval = min(float(delay), MAX_CRAWL_DELAY) if delay else 0.0
        if not interval:
            return original(self, request, **kw)

        state = host_state(host)
        with state[0]:
            wait = state[1] - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            response = original(self, request, **kw)
            # After a rate-limit reply wait much longer before the next request to this host.
            state[1] = time.monotonic() + interval * (10 if response.status_code in (429, 503) else 1)
            return response

    adapters.HTTPAdapter.send = send


def emit(kind: str, text: str) -> None:
    print(f"@@{kind} {text}", flush=True)


class ProgressSink:
    """Stands in for gpt-researcher's websocket and forwards its progress messages."""

    async def send_json(self, data) -> None:
        if not isinstance(data, dict):
            return
        kind = data.get("type")
        if kind == "logs":
            text = str(data.get("output") or data.get("content") or "").strip()
            if text:
                emit("log", text[:400].replace("\n", " "))


def _clean_report(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def check_engine_compat() -> None:
    """Fail with a clear message when an upgraded engine no longer fits this runner."""
    try:
        import _compat
        errors, warnings = _compat.check(os.environ["CONFIG_PATH"])
    except Exception as exc:  # the check itself must never be the reason a job fails
        emit("log", f"Engine compatibility check skipped ({type(exc).__name__})")
        return
    for warning in warnings:
        emit("log", f"Engine compatibility warning: {warning}")
    if errors:
        raise RuntimeError("The installed research engine no longer matches this plugin: " + "; ".join(errors)
                           + ". Roll back the engine from the engine menu.")


# ---- sectioned writer: long reports stay accurate with a small local context window ----------------

_SOURCE_BLOCK = re.compile(r"Source:[ \t]*(.*?)\nTitle:[ \t]*(.*?)\nContent:[ \t]*", re.S)


def _label(source: str) -> str:
    return source if source.lower().startswith(("http://", "https://")) else Path(source.replace("\\", "/")).name or source


def _parse_evidence(context) -> list[dict]:
    """Split gpt-researcher's context string back into (source, title, text) chunks."""
    text = "\n".join(map(str, context)) if isinstance(context, (list, tuple)) else str(context or "")
    found = list(_SOURCE_BLOCK.finditer(text))
    items, seen = [], set()
    for i, match in enumerate(found):
        end = found[i + 1].start() if i + 1 < len(found) else len(text)
        body = text[match.end():end].strip()
        if body and body[:200] not in seen:
            seen.add(body[:200])
            items.append({"source": _label(match.group(1).strip() or "unknown"), "title": match.group(2).strip(), "text": body})
    if not items and text.strip():
        items.append({"source": "research context", "title": "", "text": text.strip()})
    return items


async def write_sectioned_report(context, job: dict) -> str:
    """Outline -> one evidence-limited call per section -> introduction/conclusion -> numbered references."""
    from gpt_researcher.context.lexical import bm25_scores
    from langchain_ollama import ChatOllama

    query, words = job["query"], int(job["total_words"])
    items = _parse_evidence(context)
    if not items:
        return (f'I could not gather any source material for "{query}". Nothing was retrieved (the searches '
                "may have returned nothing or been blocked), so I cannot write a reliable, sourced report.")
    numbers: dict = {}
    for item in items:
        item["n"] = numbers.setdefault(item["source"], len(numbers) + 1)

    async def ask(prompt: str, predict: int) -> str:
        llm = ChatOllama(model=job["model"], base_url=os.environ["OLLAMA_BASE_URL"], temperature=0.3,
                         num_ctx=job["num_ctx"], num_predict=predict, reasoning=False)
        reply = await llm.ainvoke([("system", job["role"]), ("human", prompt)])
        return _clean_report(reply.content if isinstance(reply.content, str) else str(reply.content))

    n_sections = max(4, min(8, round(words / 450)))
    section_words = max(250, (words - 350) // n_sections)
    budget = max(4000, int((job["num_ctx"] - 3500) * 2.6))  # characters of evidence that fit next to the answer

    emit("log", f"Outlining the report ({len(items)} evidence passages from {len(numbers)} sources)")
    digest = "\n".join(f"- {it['title'] or it['source']}: {' '.join(it['text'][:160].split())}" for it in items[:12])
    outline = await ask(
        f"Research question: {query}\n\nEvidence collected (titles and snippets):\n{digest}\n\n"
        f"Propose {n_sections} section headings for a detailed technical report that answers the question. Cover "
        "fundamentals and mechanisms, quantitative data and design parameters, methods with their trade-offs, and "
        "limitations or open issues, as far as the evidence supports. One heading per line, no numbering, no commentary.",
        200)
    headings = []
    for line in outline.splitlines():
        line = re.sub(r"^[\s#>*\-\d.)]+", "", line).strip().strip("*\"'")
        if 3 <= len(line) <= 90 and line not in headings:
            headings.append(line)
    headings = headings[:n_sections]
    if len(headings) < 3:
        headings = ["Background and principles", "Quantitative findings and design parameters",
                    "Methods and trade-offs", "Limitations and open issues"][:n_sections]

    intro = await ask(
        f"Write a 100-130 word introduction for a technical report on: {query}\nThe report has these sections: "
        f"{'; '.join(headings)}.\nState scope and why it matters to electroacoustic / hearing-aid engineering. "
        "Do not state specific numbers or facts and do not cite; output only the paragraph.", 300)

    sections = []
    for index, heading in enumerate(headings, 1):
        emit("log", f"Writing section {index}/{len(headings)}: {heading}")
        scores = bm25_scores(f"{query} {heading}", [it["text"] for it in items])
        chosen, used = [], 0
        for i in sorted(range(len(items)), key=lambda k: -scores[k]):
            if used + len(items[i]["text"]) > budget and chosen:
                continue
            chosen.append(i)
            used += len(items[i]["text"])
            if used >= budget:
                break
        evidence = "\n\n".join(f"[{items[i]['n']}] {items[i]['title'] or items[i]['source']} ({items[i]['source']})\n"
                               f"{items[i]['text']}" for i in sorted(chosen, key=lambda k: items[k]["n"]))
        others = "; ".join(h for h in headings if h != heading)
        earlier = "\n".join(f"- {h}: {' '.join(t.split())[:250]}" for h, t in sections)
        prompt = (
            f"Write ONE section of a technical report.\nReport question: {query}\nSection heading: {heading}\n"
            f"Length: about {section_words} words.\n\nRules:\n"
            "- Use ONLY the evidence below and cite each claim as [n] with the number of the evidence item.\n"
            "- Be quantitative: include numbers, units, equations, test conditions, part names and standards when "
            "the evidence has them. If the evidence lacks a value, say so; never guess.\n"
            "- Write formulas and units as plain text with Unicode symbols (× µ ± ≈ ≤ ≥ Ω ² ⁻³); never use LaTeX or $.\n"
            "- Explain mechanisms and compare approaches, stating trade-offs.\n"
            f"- Other sections cover: {others}. Do not repeat them.\n"
            + (f"- Already written (do not restate these facts; add new detail or a new angle):\n{earlier}\n" if earlier else "")
            + "- Output only the section body in Markdown (use ### for sub-headings; no section title; no reference list).\n\n"
            f"EVIDENCE:\n{evidence}")
        text = await ask(prompt, int(section_words * 2.4) + 200)
        if not text:
            text = await ask(prompt, int(section_words * 2.4) + 200)
        text = re.sub(r"^#{1,2}\s", "### ", text, flags=re.M)
        first, _, rest = text.partition("\n")
        if first.lstrip("# ").strip().strip("*").lower() == heading.lower():  # the model repeated the title
            text = rest.strip()
        if text:
            sections.append((heading, text))

    emit("log", "Writing the conclusions")
    digest = "\n\n".join(f"{h}: {' '.join(t.split())[:450]}" for h, t in sections)
    conclusion = await ask(
        f"Based ONLY on these section summaries of a report on '{query}', write about 150 words of key takeaways and "
        f"open questions for an engineer. Keep the [n] citations that appear in the summaries.\n\n{digest}", 450)

    parts = [f"# {query.strip().rstrip('?')}", "", "## Introduction", "", intro, ""]
    for heading, text in sections:
        parts += [f"## {heading}", "", text, ""]
    parts += ["## Conclusions and open questions", "", conclusion, ""]
    body = "\n".join(parts)
    valid = set(numbers.values())
    body = re.sub(r"\s?\[(\d{1,3})\]", lambda m: m.group(0) if int(m.group(1)) in valid else "", body)
    cited = sorted({int(n) for n in re.findall(r"\[(\d{1,3})\]", body)} & valid)
    by_number = {n: s for s, n in numbers.items()}
    titles = {it["n"]: it["title"] for it in items if it["title"]}
    if cited:
        body += "\n## References\n\n" + "\n".join(
            f"[{n}] {titles[n] + ' - ' if n in titles else ''}{by_number[n]}" for n in cited) + "\n"
    return body


async def run(job: dict, job_dir: Path) -> dict:
    check_engine_compat()
    from gpt_researcher import GPTResearcher
    from gpt_researcher.utils.enum import Tone

    started = time.time()
    tone = next((t for t in Tone if t.name.lower() == str(job.get("tone", "objective")).lower()), Tone.Objective)
    detailed = job["report_type"] == "detailed_report"
    researcher = GPTResearcher(
        query=job["query"],
        report_type="research_report" if detailed else job["report_type"],
        report_source=job["source"],
        tone=tone,
        websocket=ProgressSink(),
        agent=job.get("agent") or "Engineering Research Agent",
        role=job.get("role") or None,
        max_subtopics=int(job.get("max_subtopics", 3)),
        verbose=True,
    )
    emit("phase", "research")
    await researcher.conduct_research()
    emit("phase", "writing")
    if detailed:
        report = await write_sectioned_report(researcher.context, job)
    else:
        report = _clean_report(await researcher.write_report())
    if not report:
        raise RuntimeError("The model returned an empty report. Try another model or a shorter question.")

    sources = sorted({str(u) for u in researcher.get_source_urls()})
    if sources and "http" not in report[-1500:]:
        report += "\n\n## Sources\n" + "\n".join(f"- {u}" for u in sources)
    (job_dir / "report.md").write_text(report, encoding="utf-8")
    return {"seconds": round(time.time() - started, 1), "sources": sources, "words": len(report.split())}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    job_dir = Path(sys.argv[1])
    job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))

    base = urlparse(os.environ.get("OLLAMA_BASE_URL", ""))
    if not _is_loopback(base.hostname):
        print("Refusing to run: OLLAMA_BASE_URL is not a loopback address.", file=sys.stderr)
        return 3
    install_network_guard(offline=job["source"] == "local")
    if job["source"] != "local":
        install_http_policy(job["user_agent"])
    emit("log", "Privacy guard active: " + ("offline, only this PC is reachable" if job["source"] == "local"
                                            else "web search enabled, cloud AI hosts blocked"))
    try:
        result = asyncio.run(run(job, job_dir))
    except BaseException as exc:  # noqa: BLE001 - report every failure to the plugin
        (job_dir / "error.json").write_text(
            json.dumps({"error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-3000:]}),
            encoding="utf-8")
        print(f"!! {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 1
    (job_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
