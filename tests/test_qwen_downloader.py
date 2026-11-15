import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from deploy import download_qwen_image_models as downloader
from qwen_image import ModelFile


class QwenDownloaderTests(unittest.TestCase):
    def test_turbo_opt_in_is_accepted_and_shares_existing_encoder_and_vae(self):
        from deploy import launcher, launcher_models
        args = launcher.parser().parse_args(["--qwen-image-profiles", "int8,turbo_int8", "--no-controlnet"])
        self.assertEqual(args.qwen_image_profiles, "int8,turbo_int8")
        files = downloader.selected_files(downloader.parse_profiles(args.qwen_image_profiles))
        self.assertEqual(len(files), 4)
        self.assertEqual(sum(item.name.startswith("qwen3vl") for item in files), 1)
        artifacts = launcher_models.manifest(qwen_profiles=args.qwen_image_profiles, controlnet=False)
        turbo = [item for item in artifacts if "qwen_image_2.1_turbo" in item.relative_path]
        self.assertEqual(len(turbo), 1)
        self.assertIn(downloader.MODEL_REVISION, turbo[0].url)

    def test_profile_parser_deduplicates_and_rejects_unknown_values(self):
        self.assertEqual(downloader.parse_profiles(" INT8,bf16,int8 "), ("int8", "bf16"))
        self.assertEqual(downloader.parse_profiles(""), ())
        with self.assertRaisesRegex(ValueError, "Unknown"):
            downloader.parse_profiles("fp8")

    def test_selected_files_counts_shared_vae_once(self):
        files = downloader.selected_files(("int8", "bf16"))
        self.assertEqual(len(files), 5)
        self.assertEqual(sum(item.size for item in files), 49_047_706_344)

    def test_missing_bytes_reuses_complete_cached_files_by_size(self):
        tiny_a = ModelFile("diffusion_models", "a.bin", 3, "0" * 64)
        tiny_b = ModelFile("vae", "b.bin", 5, "0" * 64)
        profiles = {"int8": {"files": (tiny_a, tiny_b)}}
        with tempfile.TemporaryDirectory() as tmp, patch.dict(downloader.MODEL_PROFILES, profiles, clear=True):
            root = Path(tmp)
            (root / "diffusion_models").mkdir()
            (root / "diffusion_models" / "a.bin").write_bytes(b"abc")
            self.assertEqual(downloader.missing_bytes(root, ("int8",)), 5)

    def test_disk_preflight_keeps_five_gib_headroom(self):
        tiny = ModelFile("diffusion_models", "a.bin", 10, "0" * 64)
        profiles = {"int8": {"files": (tiny,)}}
        with tempfile.TemporaryDirectory() as tmp, patch.dict(downloader.MODEL_PROFILES, profiles, clear=True):
            root = Path(tmp)
            with self.assertRaisesRegex(RuntimeError, "Not enough"):
                downloader.ensure_disk_space(root, ("int8",), downloader.HEADROOM_BYTES + 9)
            self.assertEqual(downloader.ensure_disk_space(root, ("int8",), downloader.HEADROOM_BYTES + 10), 10)

    def test_offline_check_verifies_hash_and_never_downloads(self):
        payload = b"complete"
        import hashlib
        tiny = ModelFile("diffusion_models", "a.bin", len(payload), hashlib.sha256(payload).hexdigest())
        profiles = {"int8": {"files": (tiny,)}}
        with tempfile.TemporaryDirectory() as tmp, patch.dict(downloader.MODEL_PROFILES, profiles, clear=True):
            root = Path(tmp)
            (root / "main.py").touch()
            target = root / "models" / "diffusion_models" / "a.bin"
            target.parent.mkdir(parents=True)
            target.write_bytes(payload)
            downloader.install_profiles(root, ("int8",), offline_check=True)
            target.write_bytes(b"corrupt!")
            with self.assertRaisesRegex(RuntimeError, "invalid"):
                downloader.install_profiles(root, ("int8",), offline_check=True)


if __name__ == "__main__":
    unittest.main()
