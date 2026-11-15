from pathlib import Path
import shutil
import subprocess
import difflib

root = Path(__file__).resolve().parents[1]
target = root / 'runtime-publish-20261115'
files = [
    'deploy-ready/pos/app.js', 'deploy-ready/pos/index.html', 'deploy-ready/pos/pages/settings.js',
    'deploy-ready/pos/SO Takeaway/so-takeaway.js',
    'deploy-ready/self-order/app.js', 'deploy-ready/self-order/index.html',
    'deploy-ready/self-order/SO Takeaway/so-takeaway.js',
    'deploy-ready/delivery/app.js', 'deploy-ready/delivery/index.html',
    'deploy-ready/delivery/Customer Order/customer-order.js',
    'deploy-ready/delivery/SO Takeaway/so-takeaway.js',
    'deploy-ready/order/index.html', 'deploy-ready/pesan/index.html',
    'deploy-ready/Customer Gateway/customer-gateway.js',
    'supabase/functions/notify-new-order/index.ts',
    'supabase/functions/notify-new-order/cashier-confirmation.mjs',
    'supabase/migrations/20261115064547_cashier_confirmation_reminder_status.sql',
    'docs/confirmation-and-reorder-20261115.md',
    'tests/customer-gateway.test.js', 'tests/cashier-confirmation-notifications.test.mjs',
    'tests/cashier-confirmation-reminder.sql'
]
assert (target / '.git').is_dir()
for file in files:
    destination = target / file
    destination.parent.mkdir(parents=True, exist_ok=True)
    original = subprocess.run(['git', 'show', f'HEAD:{file}'], cwd=target,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if original.returncode == 0:
        # Preserve existing line endings, including files with mixed endings.
        before = original.stdout.decode('utf-8')
        old_raw = before.splitlines(keepends=True)
        old_lines = before.splitlines()
        after = (root / file).read_text(encoding='utf-8')
        new_lines = after.splitlines()
        ending = '\r\n' if before.count('\r\n') > before.count('\n') / 2 else '\n'
        output = []
        for operation, i, j, a, b in difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False).get_opcodes():
            if operation == 'equal':
                output.extend(old_raw[i:j])
            elif operation in ('insert', 'replace'):
                output.extend(line + ending for line in new_lines[a:b])
        destination.write_bytes(''.join(output).encode('utf-8'))
    else:
        shutil.copy2(root / file, destination)
print(f'Copied {len(files)} release files')
subprocess.run(['git', '-c', 'core.autocrlf=false', 'add', '--', *files], cwd=target, check=True)
subprocess.run(['git', 'diff', '--cached', '--stat'], cwd=target, check=True)
subprocess.run(['git', '-c', 'core.whitespace=cr-at-eol', 'diff', '--cached', '--check'], cwd=target, check=True)
