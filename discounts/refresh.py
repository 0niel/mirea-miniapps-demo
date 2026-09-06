from __future__ import annotations

import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import socket
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 4_000_000
CATEGORIES = {"software", "design", "learning", "culture", "transport", "food", "shopping", "sport"}


class PageText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def normalize(value):
    return re.sub(r"\s+", " ", value).strip().casefold().replace("ё", "е")


def public_url(value, resolve=False):
    p = urlparse(value)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.port not in {None, 443}:
        raise ValueError("Expected public HTTPS URL")
    if any(c in value for c in "{}\\\r\n") or len(value) > 1500:
        raise ValueError("Invalid URL")
    if "." not in p.hostname or p.hostname.endswith((".local", ".localhost", ".internal")):
        raise ValueError("Expected public host")
    try:
        if not ipaddress.ip_address(p.hostname).is_global:
            raise ValueError("Non-public IP")
    except ValueError as e:
        if str(e) == "Non-public IP":
            raise
    if resolve:
        addresses = socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError("Non-public destination")
    return value


class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl, resolve=True)
        original = urlparse(req.full_url).hostname.removeprefix("www.")
        target = urlparse(newurl).hostname.removeprefix("www.")
        if original != target:
            raise ValueError("Source moved to another domain; editorial review required")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_page(url):
    public_url(url, resolve=True)
    req = Request(url, headers={"User-Agent": "MireaStudentBenefits/1.0 (+https://github.com/0niel/mirea-miniapps-demo)", "Accept": "text/html"})
    with build_opener(PublicRedirects()).open(req, timeout=25) as response:
        if response.headers.get_content_type() not in {"text/html", "application/xhtml+xml", "text/plain"}:
            raise ValueError("Unsupported source content type")
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("Source too large")
        html = raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        parser = PageText()
        parser.feed(html)
        return normalize(" ".join(parser.parts)), hashlib.sha256(raw).hexdigest()


def validate_offer(offer):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,79}", offer["id"]):
        raise ValueError("Invalid offer id")
    for key in ("title", "provider", "benefit", "description", "eligibility", "geography", "validity_note"):
        if not isinstance(offer.get(key), str) or not offer[key].strip() or len(offer[key]) > 1200 or "{{" in offer[key] or "}}" in offer[key]:
            raise ValueError("Invalid offer field: " + key)
    if offer["category"] not in CATEGORIES or offer["region"] not in {"moscow", "russia", "international", "saint-petersburg"}:
        raise ValueError("Invalid classification")
    public_url(offer["source_url"])
    public_url(offer["redeem_url"])
    if offer.get("restriction_url"):
        public_url(offer["restriction_url"])
    if not isinstance(offer["steps"], list) or not 1 <= len(offer["steps"]) <= 8:
        raise ValueError("Missing redemption steps")
    for step in offer["steps"]:
        if not isinstance(step, str) or not 1 <= len(step) <= 800 or "{{" in step or "}}" in step:
            raise ValueError("Invalid redemption step")
    if offer.get("valid_until"):
        datetime.strptime(offer["valid_until"], "%Y-%m-%d")
    if offer.get("verified_at"):
        datetime.fromisoformat(offer["verified_at"].replace("Z", "+00:00"))


def check_offer(entry, previous, now, page_result):
    offer = copy.deepcopy(entry["offer"])
    validate_offer(offer)
    prior = previous.get(offer["id"])
    offer["verified_at"] = None
    offer.pop("source_sha256", None)
    fallback = copy.deepcopy(prior) if prior and prior.get("verified_at") else copy.deepcopy(offer)
    fallback["checked_at"] = now
    offer["checked_at"] = now
    if isinstance(page_result, Exception):
        fallback["source_status"] = "unavailable"
        return fallback, {"id": offer["id"], "status": "unavailable", "reason": type(page_result).__name__, "attempted_source_url": offer["source_url"]}
    page, digest = page_result
    assertions = entry.get("assertions", [])
    if len(assertions) < 2:
        raise ValueError("At least benefit and eligibility assertions required")
    missing = [a for a in assertions if normalize(a) not in page]
    excluded = [a for a in entry.get("reject_if", []) if normalize(a) in page]
    if missing or excluded:
        fallback["source_status"] = "changed"
        return fallback, {"id": offer["id"], "status": "changed", "missing_assertions": missing, "rejected_assertions": excluded, "attempted_source_url": offer["source_url"]}
    offer.update(verified_at=now, source_status="checked", source_sha256=digest)
    return offer, {"id": offer["id"], "status": "checked", "source_sha256": digest}


def refresh(registry, previous, now, fetcher=fetch_page):
    urls = list(dict.fromkeys(e["offer"]["source_url"] for e in registry))
    def load(url):
        try:
            return url, fetcher(url)
        except Exception as error:
            return url, error
    with ThreadPoolExecutor(max_workers=4) as pool:
        pages = dict(pool.map(load, urls))
    old = {e["id"]: e for e in previous.get("offers", [])}
    checked = [check_offer(e, old, now, pages[e["offer"]["source_url"]]) for e in registry]
    ids = [e[0]["id"] for e in checked]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate offer ids")
    return {"schema_version": 1, "generated_at": now, "offers": [e[0] for e in checked]}, {"checked_at": now, "results": [e[1] for e in checked]}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    temporary.replace(path)


def main():
    p = argparse.ArgumentParser(description="Check official offers and emit public catalog data")
    p.add_argument("--registry", type=Path, default=ROOT / "sources.json")
    p.add_argument("--output", type=Path, default=ROOT / "data/catalog.json")
    p.add_argument("--report", type=Path, default=ROOT / "data/check-report.json")
    p.add_argument("--sql", type=Path, help="Generate service-role import SQL from the checked catalog")
    p.add_argument("--from-catalog", action="store_true", help="Validate existing catalog and emit SQL without network")
    p.add_argument("--strict", action="store_true", help="Exit 1 if any official source cannot confirm the offer")
    args = p.parse_args()
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    if args.from_catalog:
        catalog = previous
        if catalog.get("schema_version") != 1 or not catalog.get("offers"):
            p.error("Catalog is missing or invalid")
        for offer in catalog["offers"]:
            validate_offer(offer)
        failures = 0
    else:
        registry = json.loads(args.registry.read_text(encoding="utf-8"))
        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        catalog, report = refresh(registry, previous, now)
        write_json(args.output, catalog)
        write_json(args.report, report)
        failures = sum(r["status"] != "checked" for r in report["results"])
    if args.sql:
        args.sql.parent.mkdir(parents=True, exist_ok=True)
        serialized = json.dumps(catalog, ensure_ascii=False).replace("'", "''")
        args.sql.write_text("select public.student_discounts_import('" + serialized + "'::jsonb);\n", encoding="utf-8")
    print(json.dumps({"offers": len(catalog["offers"]), "unconfirmed_sources": failures, "output": str(args.output)}, ensure_ascii=False))
    return 1 if args.strict and failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
