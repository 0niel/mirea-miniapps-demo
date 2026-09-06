import argparse
import json
import time
import urllib.error
import urllib.request

URL = "https://ejzybbyjwtzbibrrwrli.supabase.co/functions/v1/miniapp-sync-student-data"


def sync(revision: str, timeout: int = 1200) -> dict:
    deadline = time.monotonic() + timeout
    last = {}
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(URL, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=75) as response:
                last = json.load(response)
            print(json.dumps(last, ensure_ascii=False), flush=True)
            if last.get("completedRevision") == revision and last.get("cursor") == last.get("total"):
                return last
        except (urllib.error.URLError, TimeoutError) as error:
            print(f"Refresh request will retry: {type(error).__name__}", flush=True)
        time.sleep(10)
    raise RuntimeError(f"Dataset publication not confirmed: {last}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    parser.add_argument("--timeout", type=int, default=1200)
    args = parser.parse_args()
    if len(args.revision) != 40 or any(c not in "0123456789abcdef" for c in args.revision):
        parser.error("Expected a commit SHA")
    sync(args.revision, args.timeout)
