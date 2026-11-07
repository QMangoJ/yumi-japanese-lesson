#!/usr/bin/env python3
"""Migrate Yumi bookings + subscriptions from KV to the dedicated D1
database `yumi-bookings-db` (task 10).

Reads every `booking:` / `subscription:` value from the live KV
namespace, writes it into D1 (full JSON in `doc`, queryable fields
extracted into columns — the same extraction src/lib/store.js does),
then reads everything back and compares FIELD BY FIELD against the
KV source. KV is only ever read, never written: it stays as the
rollback copy.

Usage: python3 scripts/migrate_d1.py [D1_DATABASE_ID]
Auth rides the Cloudflare connector's stored credential, exactly
like deploy.py — nothing is printed or written to disk.
"""
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = "247487e5bb3580a0727fd0d85dbc80e0"
KV_NAMESPACE_ID = "4ecf0f685982442e91a40397d88183b9"
DB_ID = sys.argv[1] if len(sys.argv) > 1 else "99eae9b6-e033-467b-aa29-ad35f0d0b971"
LEGACY_MINUTES = {"trial": 25, "single": 60, "pack5": 60, "pack10": 60}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused")


def api(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    add_surrogate_to_request(req, "custom.cloudflare",
                             allowed_hosts=["api.cloudflare.com"])
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as resp:
            payload = resp.read()
            return payload.decode() if raw else json.loads(payload)
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        raise SystemExit(f"HTTP {e.code} on {method} {path}: {payload[:400]}")


def d1_query(sql, params=None):
    out = api("POST", f"/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query",
              {"sql": sql, "params": params or []})
    if not out.get("success"):
        raise SystemExit(f"D1 query failed: {json.dumps(out.get('errors'))[:300]}\nSQL: {sql[:120]}")
    return out["result"][0]


def kv_keys(prefix):
    names, cursor = [], None
    while True:
        q = f"?prefix={urllib.parse.quote(prefix)}&limit=1000"
        if cursor:
            q += f"&cursor={urllib.parse.quote(cursor)}"
        out = api("GET", f"/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_NAMESPACE_ID}/keys{q}")
        names += [k["name"] for k in out["result"]]
        cursor = out.get("result_info", {}).get("cursor")
        if not cursor:
            return names


def kv_get(key):
    return api("GET", f"/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_NAMESPACE_ID}"
                      f"/values/{urllib.parse.quote(key, safe='')}", raw=True)


def to_min(t):
    h, m = str(t).split(":")
    return int(h) * 60 + int(m)


def minutes_of(b):
    if b.get("durationMinutes"):
        return b["durationMinutes"]
    return LEGACY_MINUTES.get(b.get("lessonTypeId"), 60)


def lesson_start_ms(b):
    import datetime
    y, mo, d = map(int, b["date"].split("-"))
    base = datetime.datetime(y, mo, d, tzinfo=datetime.timezone.utc).timestamp()
    return int(base * 1000) - 9 * 3600_000 + to_min(b["time"]) * 60_000


def booking_cols(b):
    start = to_min(b["time"])
    return [b["id"], str(b.get("email") or "").lower(), b["date"], b["time"],
            b["status"], b.get("subscriptionId"), start,
            start + minutes_of(b), lesson_start_ms(b), b.get("amount"),
            b.get("paidAt"), b.get("createdAt"), json.dumps(b, ensure_ascii=False)]


def sub_cols(s):
    return [s["id"], str(s.get("email") or "").lower(), s["status"],
            s.get("paidAt"), s.get("createdAt"), json.dumps(s, ensure_ascii=False)]


def schema_sql():
    src = open("/home/hatch/workspace/yumi-site/src/lib/store.js", encoding="utf8").read()
    m = re.search(r"export const D1_SCHEMA = `([\s\S]*?)`;", src)
    if not m:
        raise SystemExit("D1_SCHEMA not found in src/lib/store.js")
    return m.group(1)


def canon(rec):
    return json.dumps(rec, sort_keys=True, ensure_ascii=False)


def main():
    print("== reading KV source ==")
    bookings, subs = {}, {}
    for key in kv_keys("booking:"):
        bookings[key[len("booking:"):]] = json.loads(kv_get(key))
    for key in kv_keys("subscription:"):
        subs[key[len("subscription:"):]] = json.loads(kv_get(key))
    print(f"KV: {len(bookings)} bookings, {len(subs)} subscriptions")

    print("== creating schema in D1 ==")
    for stmt in [s.strip() for s in schema_sql().split(";") if s.strip()]:
        d1_query(stmt)

    print("== inserting ==")
    bcols = "id, email, date, time, status, subscription_id, start_min, end_min, lesson_start_ms, amount, paid_at, created_at, doc"
    for b in bookings.values():
        d1_query(f"INSERT OR REPLACE INTO bookings ({bcols}) VALUES ({', '.join('?' * 13)})",
                 booking_cols(b))
    scols = "id, email, status, paid_at, created_at, doc"
    for s in subs.values():
        d1_query(f"INSERT OR REPLACE INTO subscriptions ({scols}) VALUES ({', '.join('?' * 6)})",
                 sub_cols(s))

    print("== reading back + field-by-field comparison ==")
    back_b = {r["id"]: json.loads(r["doc"]) for r in
              d1_query("SELECT id, doc FROM bookings")["results"]}
    back_s = {r["id"]: json.loads(r["doc"]) for r in
              d1_query("SELECT id, doc FROM subscriptions")["results"]}
    diffs = []
    for rid, rec in bookings.items():
        if rid not in back_b:
            diffs.append(f"booking {rid}: missing in D1")
        elif canon(back_b[rid]) != canon(rec):
            diffs.append(f"booking {rid}: content differs")
    for rid, rec in subs.items():
        if rid not in back_s:
            diffs.append(f"subscription {rid}: missing in D1")
        elif canon(back_s[rid]) != canon(rec):
            diffs.append(f"subscription {rid}: content differs")
    if len(back_b) != len(bookings):
        diffs.append(f"booking count: KV {len(bookings)} vs D1 {len(back_b)}")
    if len(back_s) != len(subs):
        diffs.append(f"subscription count: KV {len(subs)} vs D1 {len(back_s)}")

    def smoke(recs_b, recs_s):
        emails = {str(r.get('email') or '').lower() for r in list(recs_b.values()) + list(recs_s.values())}
        paid_sum = sum(r.get("amount") or 0 for r in recs_b.values() if r.get("status") == "paid")
        sub_sum = sum(r.get("totalPrice") or 0 for r in recs_s.values() if r.get("status") in ("active", "stopped", "completed"))
        by_status = {}
        for r in recs_b.values():
            by_status[r.get("status")] = by_status.get(r.get("status"), 0) + 1
        return {"bookings": len(recs_b), "subscriptions": len(recs_s),
                "distinct_students": len(emails), "paid_booking_amount_sum": paid_sum,
                "package_total_sum": sub_sum, "booking_statuses": by_status}

    kv_smoke, d1_smoke = smoke(bookings, subs), smoke(back_b, back_s)
    print("smoke (KV):", json.dumps(kv_smoke, ensure_ascii=False))
    print("smoke (D1):", json.dumps(d1_smoke, ensure_ascii=False))
    if kv_smoke != d1_smoke:
        diffs.append("smoke numbers differ")

    if diffs:
        print(f"\nMIGRATION MISMATCH ({len(diffs)}):")
        for d in diffs[:20]:
            print(" -", d)
        return 1
    print(f"\nMIGRATION OK: {len(bookings)} bookings + {len(subs)} subscriptions, "
          "every record field-identical between KV and D1.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
