#!/usr/bin/env python3
"""Check supported OS versions without mutating the host's package manager."""
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy/platform.sh'

class Platforms(unittest.TestCase):
    def test_version_boundaries(self):
        cases = [
            ('ubuntu', '22.04', 'apt'), ('ubuntu', '24.04', 'apt'),
            ('ubuntu', '26.04', 'apt'), ('debian', '12', 'apt'), ('debian', '13', 'apt'),
            ('rocky', '9.6', 'dnf'), ('almalinux', '9.6', 'dnf'),
            ('rhel', '9.6', 'dnf'), ('centos', '9', 'dnf'),
            ('ubuntu', '20.04', None), ('debian', '11', None),
            ('centos', '7', None), ('rocky', '90', None), ('alpine', '3.22', None),
        ]
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory) / 'os-release'
            for distro, version, manager in cases:
                with self.subTest(distro=distro, version=version):
                    release.write_text(f'ID={distro}\nVERSION_ID={version}\nPRETTY_NAME="Fixture Linux"\n')
                    result = subprocess.run(['bash', '-c',
                        'source "$1"; agentvps_detect_platform "$2" && printf "manager=%s" "$agentvps_package_manager"',
                        'platform-check', str(SCRIPT), str(release)], text=True, capture_output=True)
                    if manager:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn('manager=' + manager, result.stdout)
                    else:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('Unsupported system', result.stderr)

if __name__ == '__main__':
    unittest.main(verbosity=2)
