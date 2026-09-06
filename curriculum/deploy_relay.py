import argparse
import hashlib
import json
import secrets
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from fetch import MAX_CATALOG_BYTES, fetch_relay


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder-id', required=True)
    parser.add_argument('--profile', default='default')
    parser.add_argument('--repository', default='0niel/mirea-miniapps-demo')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    command = ['yc', '--profile', args.profile, '--folder-id', args.folder_id]

    def yc(*values):
        result = subprocess.run(command + list(values) + ['--format', 'json'], capture_output=True, text=True, encoding='utf-8')
        if result.returncode:
            raise RuntimeError('Cloud source deployment command failed: ' + ' '.join(values[:3]))
        return json.loads(result.stdout) if result.stdout.strip() else None

    functions = yc('serverless', 'function', 'list')
    existing = next((function for function in functions if function['name'] == 'learning-source-relay'), None)
    function = existing or yc('serverless', 'function', 'create', '--name', 'learning-source-relay')
    function_id = function['id']
    token = secrets.token_urlsafe(48)
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / 'source.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
            for filename in ['relay.py', 'fetch.py']:
                package.write(root / filename, filename)
        version = yc('serverless', 'function', 'version', 'create', '--function-id', function_id,
                     '--runtime', 'python312', '--entrypoint', 'relay.handler', '--memory', '512MB',
                     '--execution-timeout', '60s', '--source-path', str(archive), '--no-logging',
                     '--environment', 'SOURCE_RELAY_TOKEN=' + token)
    yc('serverless', 'function', 'set-scaling-policy', '--id', function_id, '--tag', '$latest',
       '--zone-instances-limit', '2', '--zone-requests-limit', '4')
    yc('serverless', 'function', 'allow-unauthenticated-invoke', '--id', function_id)
    endpoint = 'https://functions.yandexcloud.net/' + function_id
    try:
        with urllib.request.urlopen(endpoint, timeout=20):
            raise RuntimeError('Source relay unexpectedly accepted a request without a token')
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise RuntimeError('Source relay unauthorized request did not return 401') from error
    source = 'https://www.mirea.ru/sveden/education/eduop/'
    raw, checked = fetch_relay(source, endpoint, token, MAX_CATALOG_BYTES)
    if raw.count(b'eduPlan') < 100:
        raise RuntimeError('Source relay returned an invalid catalog')
    subprocess.run(['gh', 'secret', 'set', 'MIREA_SOURCE_RELAY_TOKEN', '--repo', args.repository],
                   input=token, text=True, capture_output=True, check=True)
    subprocess.run(['gh', 'variable', 'set', 'MIREA_SOURCE_RELAY_URL', '--repo', args.repository, '--body', endpoint],
                   capture_output=True, check=True)
    report = {'function_id': function_id, 'version_id': version['id'], 'endpoint': endpoint,
              'source_url': source, 'source_bytes': len(raw), 'source_hash': hashlib.sha256(raw).hexdigest(),
              'fetched_at': checked, 'unauthorized_status': 401}
    target = root / 'public' / 'relay-deployment.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
