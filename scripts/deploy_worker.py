#!/usr/bin/env python3
"""Upload dependency-free Worker modules and optionally apply the D1 schema."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('account-id', 'name', 'd1-id'):
        parser.add_argument('--' + flag, required=True)
    parser.add_argument('--entry', choices=('index', 'test'), default='index')
    parser.add_argument('--team-domain', default='https://empty-math-1944.cloudflareaccess.com')
    parser.add_argument('--aud', default='')
    parser.add_argument('--allowed-emails', default='')
    parser.add_argument('--garden-owner', default='', help='Shared data owner key for everyone allowed in (default: each email has its own garden)')
    parser.add_argument('--token-file', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--apply-schema', action='store_true')
    args = parser.parse_args()
    if args.entry == 'index' and not args.aud:
        parser.error('--aud is required for the production entry')
    entry = 'index.js' if args.entry == 'index' else 'test-entry.js'
    modules = [entry, 'api.js', 'access.js']
    metadata = {
        'main_module': entry,
        'compatibility_date': '2025-09-01',
        'bindings': [
            {'type': 'd1', 'name': 'DB', 'id': args.d1_id},
            *({'type': 'plain_text', 'name': name, 'text': value} for name, value in (
                ('ACCESS_TEAM_DOMAIN', args.team_domain),
                ('ACCESS_AUD', args.aud), ('ALLOWED_EMAILS', args.allowed_emails),
                ('GARDEN_OWNER', args.garden_owner)))
        ],
    }
    if args.dry_run:
        print(json.dumps(metadata, indent=2))
        print('Parts: metadata (application/json), ' + ', '.join(
            name + ' (application/javascript+module)' for name in modules))
        print('Apply schema:', args.apply_schema, '(dry run; no network calls)')
        return 0
    try:
        token = args.token_file.read_text().strip() if args.token_file else os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()
    except OSError:
        print('Could not read token file.', file=sys.stderr)
        return 1
    if not token:
        parser.error('Provide --token-file or CLOUDFLARE_API_TOKEN')
    base = 'https://api.cloudflare.com/client/v4/accounts/' + urllib.parse.quote(args.account_id, safe='')

    def call(path, method, data, content_type):
        req = urllib.request.Request(base + path, data=data, method=method,
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': content_type})
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            try:
                result = json.loads(error.read())
            except (ValueError, UnicodeError):
                result = {'success': False, 'errors': [{'message': 'HTTP ' + str(error.code)}]}
        except (urllib.error.URLError, TimeoutError):
            print('success: false; errors: network request failed', file=sys.stderr)
            return False
        # Only report API status, never request headers or credentials.
        print('success:', json.dumps(result.get('success', False)))
        print('errors:', json.dumps(result.get('errors', [])))
        for item in result.get('result', []) if isinstance(result.get('result'), list) else []:
            if item.get('success') is False:
                print('statement errors:', json.dumps(item.get('errors', item.get('error', []))))
                return False
        return result.get('success') is True

    if args.apply_schema:
        # The schema contains simple CREATE statements without semicolons in literals.
        statements = [s.strip() for s in (ROOT / 'worker/schema.sql').read_text().split(';') if s.strip()]
        for number, sql in enumerate(statements, 1):
            print('Schema statement', number)
            if not call('/d1/database/' + urllib.parse.quote(args.d1_id, safe='') + '/query',
                        'POST', json.dumps({'sql': sql}).encode(), 'application/json'):
                return 1
    boundary = 'garden-' + uuid.uuid4().hex
    chunks = []

    def part(name, content_type, data, filename=None):
        disposition = 'Content-Disposition: form-data; name="' + name + '"'
        if filename:
            disposition += '; filename="' + filename + '"'
        chunks.extend([('--' + boundary + '\r\n' + disposition + '\r\nContent-Type: ' + content_type + '\r\n\r\n').encode(), data, b'\r\n'])

    part('metadata', 'application/json', json.dumps(metadata).encode())
    for name in modules:
        part(name, 'application/javascript+module', (ROOT / 'worker' / name).read_bytes(), name)
    chunks.append(('--' + boundary + '--\r\n').encode())
    print('Uploading', args.name, 'with', entry)
    return 0 if call('/workers/scripts/' + urllib.parse.quote(args.name, safe=''), 'PUT',
                     b''.join(chunks), 'multipart/form-data; boundary=' + boundary) else 1


if __name__ == '__main__':
    sys.exit(main())
