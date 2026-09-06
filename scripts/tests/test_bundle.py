import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("bundle_data", Path(__file__).parents[1] / "bundle_data.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "curriculum/data").mkdir(parents=True)
        (self.root / "discounts/data").mkdir(parents=True)
        self.raw = json.dumps(dict(schema_version=1, plans=[dict(id="test")])).encode()
        (self.root / "curriculum/data/catalog-000.json").write_bytes(self.raw)
        self.manifest = dict(generated_at="2026-09-06T00:00:00Z", chunks=[dict(
            file="catalog-000.json", bytes=len(self.raw), sha256=hashlib.sha256(self.raw).hexdigest(), plan_count=1)])
        (self.root / "discounts/data/catalog.json").write_text(json.dumps(dict(
            schema_version=1, generated_at="2026-09-06T01:00:00Z", offers=[dict(id="discount")])))
        self.write_manifest()

    def write_manifest(self):
        (self.root / "curriculum/data/manifest.json").write_text(json.dumps(self.manifest))

    def test_bundle_is_deterministic(self):
        first = bundle.build(self.root)
        self.assertEqual(first, bundle.build(self.root))
        self.assertEqual(first["generated_at"], "2026-09-06T01:00:00Z")
        self.assertEqual(len(first["assets"]), 2)

    def test_tampered_chunk_is_rejected(self):
        (self.root / "curriculum/data/catalog-000.json").write_bytes(b"{}")
        with self.assertRaises(ValueError):
            bundle.build(self.root)

    def test_path_escape_is_rejected(self):
        self.manifest["chunks"][0]["file"] = "../../outside.json"
        self.write_manifest()
        with self.assertRaises(ValueError):
            bundle.build(self.root)


if __name__ == "__main__":
    unittest.main()
