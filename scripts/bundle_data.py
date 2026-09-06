import hashlib
import json
from pathlib import Path


def build(root: Path) -> dict:
    curriculum = json.loads((root / "curriculum/data/manifest.json").read_text(encoding="utf-8"))
    discounts_path = root / "discounts/data/catalog.json"
    discounts = json.loads(discounts_path.read_text(encoding="utf-8"))
    assets = []
    for entry in curriculum["chunks"]:
        relative = "curriculum/data/" + entry["file"]
        resolved = (root / relative).resolve()
        if resolved.parent != (root / "curriculum/data").resolve():
            raise ValueError("Invalid curriculum file")
        raw = resolved.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if len(raw) != entry["bytes"] or digest != entry["sha256"]:
            raise ValueError("Curriculum manifest checksum mismatch")
        payload = json.loads(raw)
        if len(payload["plans"]) != entry["plan_count"] or not 1 <= len(raw) <= 1048576:
            raise ValueError("Invalid curriculum chunk")
        assets.append(dict(path=relative, sha256=digest, bytes=len(raw), count=entry["plan_count"], dataset="curriculum"))
    raw = discounts_path.read_bytes()
    if not discounts["offers"] or len(discounts["offers"]) > 200 or len(raw) > 1048576:
        raise ValueError("Invalid discounts catalog")
    assets.append(dict(path="discounts/data/catalog.json", sha256=hashlib.sha256(raw).hexdigest(),
                       bytes=len(raw), count=len(discounts["offers"]), dataset="discounts"))
    return dict(schema_version=1, generated_at=max(curriculum["generated_at"], discounts["generated_at"]), assets=assets)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    manifest = build(root)
    target = root / "data/manifest.json"
    target.parent.mkdir(exist_ok=True)
    target.write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(json.dumps(dict(assets=len(manifest["assets"]), records=sum(item["count"] for item in manifest["assets"]))))
