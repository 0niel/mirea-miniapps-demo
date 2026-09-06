import copy
from datetime import datetime
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("discount_refresh", ROOT / "refresh.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class RefreshTests(unittest.TestCase):
    def test_published_bytes_do_not_depend_on_platform_newlines(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            refresh.write_json(path, {"title": "Скидки"})
            self.assertEqual(path.read_bytes(), '{\n  "title": "Скидки"\n}\n'.encode("utf-8"))

    def setUp(self):
        self.entry = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))[0]
        self.old = copy.deepcopy(self.entry["offer"])
        self.old["verified_at"] = "2026-08-20T12:00:00Z"
        self.previous = {self.old["id"]: self.old}
        self.now = "2026-09-06T09:00:00Z"

    def test_http_success_without_benefit_does_not_verify(self):
        offer, report = refresh.check_offer(self.entry, self.previous, self.now, ("github student developer pack offer removed", "a" * 64))
        self.assertEqual(offer["source_status"], "changed")
        self.assertEqual(offer["verified_at"], self.old["verified_at"])
        self.assertTrue(report["missing_assertions"])

    def test_network_failure_retains_last_good_verification(self):
        offer, report = refresh.check_offer(self.entry, self.previous, self.now, TimeoutError())
        self.assertEqual(offer["verified_at"], self.old["verified_at"])
        self.assertEqual(offer["source_status"], "unavailable")
        self.assertEqual(offer["checked_at"], self.now)
        self.assertEqual(report["reason"], "TimeoutError")

    def test_complete_evidence_updates_verification(self):
        text = refresh.normalize(" ".join(self.entry["assertions"]))
        offer, report = refresh.check_offer(self.entry, self.previous, self.now, (text, "a" * 64))
        self.assertEqual(offer["verified_at"], self.now)
        self.assertEqual(offer["source_status"], "checked")

    def test_first_failed_fetch_cannot_inherit_editorial_verification(self):
        self.entry["offer"]["verified_at"] = "2026-09-06T08:00:00Z"
        self.entry["offer"]["source_sha256"] = "a" * 64
        for response in [TimeoutError(), ("benefit removed", "b" * 64)]:
            offer, report = refresh.check_offer(self.entry, {}, self.now, response)
            self.assertIsNone(offer["verified_at"])
            self.assertNotIn("source_sha256", offer)
            self.assertNotEqual(offer["source_status"], "checked")

    def test_unconfirmed_editorial_edit_keeps_entire_last_good_offer(self):
        self.old["source_sha256"] = "a" * 64
        self.entry["offer"]["benefit"] = "Скидка 90%"
        self.entry["offer"]["source_url"] = "https://changed.example.org/"
        for response in [TimeoutError(), ("offer removed", "b" * 64)]:
            offer, report = refresh.check_offer(self.entry, self.previous, self.now, response)
            self.assertEqual(offer["benefit"], self.old["benefit"])
            self.assertEqual(offer["source_url"], self.old["source_url"])
            self.assertEqual(offer["source_sha256"], self.old["source_sha256"])
            self.assertEqual(offer["verified_at"], self.old["verified_at"])
            self.assertEqual(report["attempted_source_url"], self.entry["offer"]["source_url"])

    def test_script_content_cannot_supply_missing_evidence(self):
        parser = refresh.PageText()
        parser.feed('<p>Offers</p><script>Free GitHub Pro while you are a student.</script><style>GitHub Student Developer Pack</style>')
        self.assertNotIn("Free", " ".join(parser.parts))

    def test_registry_is_diverse_and_has_real_sources(self):
        entries = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(entries), 10)
        self.assertGreaterEqual(len({e["offer"]["category"] for e in entries}), 5)
        for entry in entries:
            refresh.validate_offer(entry["offer"])
            self.assertGreaterEqual(len(entry["assertions"]), 2)
            self.assertNotIn("example", entry["offer"]["source_url"])

    def test_catalog_checks_match_current_registry(self):
        catalog = json.loads((ROOT / "data/catalog.json").read_text(encoding="utf-8"))
        registry = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
        self.assertEqual({e["id"] for e in catalog["offers"]}, {e["offer"]["id"] for e in registry})
        for offer in catalog["offers"]:
            refresh.validate_offer(offer)
            if offer.get("verified_at"):
                self.assertLessEqual(offer["verified_at"], offer["checked_at"])
            if offer["source_status"] == "checked":
                self.assertIsNotNone(offer["verified_at"])
                self.assertRegex(offer["source_sha256"], r"^[0-9a-f]{64}$")

    def test_private_and_malformed_urls_rejected(self):
        for url in ["http://example.com", "https://localhost/", "https://127.0.0.1/", "https://169.254.169.254/", "https://user:password@example.com/", "https://example.com/{{state.secret}}"]:
            with self.assertRaises(ValueError, msg=url):
                refresh.public_url(url)

    def test_injected_or_empty_fields_rejected(self):
        for key, value in [("title", "{{state.secret}}"), ("category", "__proto__"), ("eligibility", ""), ("steps", ["{{state.token}}"]), ("valid_until", "2026-02-30")]:
            offer = copy.deepcopy(self.old)
            offer[key] = value
            with self.assertRaises(ValueError, msg=key):
                refresh.validate_offer(offer)

    def test_single_fetch_for_shared_source(self):
        second = copy.deepcopy(self.entry)
        second["offer"]["id"] = "another-offer"
        calls = []
        def fetch(url):
            calls.append(url)
            return refresh.normalize(" ".join(self.entry["assertions"])), "a" * 64
        result, report = refresh.refresh([self.entry, second], {"offers": [self.old]}, self.now, fetch)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(result["offers"]), 2)


if __name__ == "__main__":
    unittest.main()
