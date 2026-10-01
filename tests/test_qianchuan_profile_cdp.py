import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

script = Path(__file__).resolve().parents[1] / "scripts/enable-qianchuan-profile-cdp.py"
spec = importlib.util.spec_from_file_location("profile_cdp", script)
cdp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)


class ProfileCdpTests(unittest.TestCase):
    def manager(self, base):
        # Execute the exact helper installed by the patch, without any Chrome state.
        namespace = {}
        exec("import os, json\nfrom pathlib import Path\nclass ProfileStateError(Exception): pass\nclass Manager:\n" + cdp.HELPER, namespace)
        manager = namespace["Manager"]()
        manager.base = base
        manager._validate_id = lambda value: cdp.re.fullmatch(r"cp-[0-9a-f]{12}", value) or (_ for _ in ()).throw(ValueError("invalid ID"))
        return manager

    def test_opt_in_only_and_invalid_private_config(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            manager = self.manager(base)
            self.assertFalse(manager._cdp_enabled("cp-123456789abc"))
            config = base / "cdp-profiles.json"
            cdp.atomic_write(config, json.dumps({"version": 1, "profiles": ["cp-123456789abc"]}).encode(), 0o600)
            self.assertTrue(manager._cdp_enabled("cp-123456789abc"))
            self.assertFalse(manager._cdp_enabled("cp-abcdef123456"))
            config.chmod(0o644)
            with self.assertRaises(Exception): manager._cdp_enabled("cp-123456789abc")
            config.unlink()
            other = base / "other"; other.write_text("{}"); config.symlink_to(other)
            with self.assertRaises(Exception): manager._cdp_enabled("cp-123456789abc")

    def test_patch_keeps_launch_arguments_and_is_idempotent(self):
        source = "class Manager:\n    def launch_argv(self, profile_id):\n        with self.locked():\n            argv = [\n                self.chrome_bin,\n                f'--profile-directory={directory}',\n                f'--class={profile_id}',\n            ]\n        if new_window:\n            argv.append('--new-window')\n        return argv\n"
        patched = cdp.patch_manager(source)
        compile(patched, "manager.py", "exec")
        self.assertEqual(patched, cdp.patch_manager(patched))
        self.assertIn("f'--profile-directory={directory}'", patched)
        self.assertIn("f'--class={profile_id}'", patched)
        self.assertIn('"--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"', patched)
        with self.assertRaises(ValueError): cdp.patch_manager("unrecognized source")

    def test_installer_refuses_changed_source_without_writing(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / "manager.py"; source.write_text("changed source")
            with self.assertRaises(ValueError): cdp.install(base, ["cp-123456789abc"])
            self.assertEqual("changed source", source.read_text())
            self.assertFalse((base / "cdp-profiles.json").exists())


if __name__ == "__main__": unittest.main()
