#!/usr/bin/env python3
"""Exercise setup outcomes with isolated firewall/network commands and a fixture token."""
import errno
import os
from pathlib import Path
import pty
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'website/public/install.sh'
COMMAND = 'source "$1"; agentvps_finish_setup "$2" "$3" "$4"'
TOKEN = 'test-fixture-token-not-a-credential'


class BootstrapSetup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agentvps setup ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'environment'
        self.token = self.root / 'token'
        self.token.write_text(TOKEN)
        self.token.chmod(0o600)
        self.calls = self.root / 'firewall-calls'
        self.calls.touch()
        self.env = dict(os.environ, PATH=f'{self.root}:{os.environ["PATH"]}',
                        TEST_CALLS=str(self.calls), TEST_UFW='active', TEST_IP='8.8.4.4')
        self.stub('ufw', '''printf '%s\\n' "$*" >> "$TEST_CALLS"
if [[ $1 == status ]]; then
  [[ $TEST_UFW != status-error ]] || exit 1
  printf 'Status: %s\\n' "$TEST_UFW"
else
  [[ ${TEST_FAIL_RULE:-0} != 1 ]]
fi
''')
        self.stub('curl', 'printf "%s" "$TEST_IP"\n')

    def stub(self, name, body):
        file = self.root / name
        file.write_text('#!/bin/bash\n' + body)
        file.chmod(0o755)

    def run_setup(self, mode='auto', terminal=False):
        args = ['bash', '-c', COMMAND, 'setup-check', str(SCRIPT), mode,
                str(self.config), str(self.token)]
        if not terminal:
            result = subprocess.run(args, env=self.env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout + result.stderr
        master, slave = pty.openpty()
        process = subprocess.Popen(args, env=self.env, stdout=slave, stderr=slave)
        os.close(slave)
        output = bytearray()
        try:
            while True:
                try:
                    chunk = os.read(master, 4096)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                output.extend(chunk)
        finally:
            os.close(master)
        self.assertEqual(process.wait(timeout=10), 0)
        return output.decode()

    def test_active_firewall_opens_only_desktop_and_hides_captured_token(self):
        output = self.run_setup()
        self.assertEqual(self.calls.read_text().splitlines(),
                         ['status', 'allow 8080/tcp comment AgentVPS desktop'])
        self.assertIn('http://8.8.4.4:8080', output)
        self.assertIn('cloud provider firewall', output)
        self.assertNotIn(TOKEN, output)

    def test_inactive_firewall_is_not_enabled(self):
        self.env['TEST_UFW'] = 'inactive'
        output = self.run_setup()
        self.assertEqual(self.calls.read_text(), 'status\n')
        self.assertIn('UFW is inactive', output)

    def test_custom_port_and_public_origin_are_preserved(self):
        self.config.write_text('AGENTVPS_PORT="9090"\nAGENTVPS_PUBLIC_URL=https://desktop.example.com\n')
        output = self.run_setup()
        self.assertIn('allow 9090/tcp', self.calls.read_text())
        self.assertIn('https://desktop.example.com', output)
        self.assertNotIn('http://8.8.4.4', output)

    def test_private_binding_keeps_firewall_untouched(self):
        for host in ['127.0.0.1', '::1', 'localhost']:
            self.config.write_text(f'AGENTVPS_HOST={host}\n')
            output = self.run_setup()
            self.assertEqual(self.calls.read_text(), '')
            self.assertIn('no firewall rules changed', output)
            self.assertNotIn('cloud provider firewall', output)

    def test_failed_firewall_changes_are_reported(self):
        self.env['TEST_FAIL_RULE'] = '1'
        output = self.run_setup()
        self.assertIn('could not open TCP 8080', output)
        self.assertNotIn('allowed in UFW', output)
        self.env['TEST_UFW'] = 'status-error'
        self.assertIn('could not inspect UFW', self.run_setup())

    def test_invalid_ip_response_is_not_displayed_or_executed(self):
        for address in ['', '10.0.0.1', '<html>unavailable</html>', 'bad; echo injected']:
            self.env['TEST_IP'] = address
            output = self.run_setup()
            self.assertIn('http://YOUR_VPS_IP:8080', output)
            self.assertNotIn('injected', output)

    def test_interactive_terminal_displays_login_token(self):
        self.assertIn(TOKEN, self.run_setup(terminal=True))

    def test_agent_mode_hides_token_even_in_terminal(self):
        self.assertNotIn(TOKEN, self.run_setup(mode='never', terminal=True))


if __name__ == '__main__':
    unittest.main(verbosity=2)
