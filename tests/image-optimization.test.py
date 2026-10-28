import importlib.util
from pathlib import Path
import tempfile
import unittest
from PIL import Image

spec = importlib.util.spec_from_file_location('optimizer', Path(__file__).parents[1] / 'scripts/optimize-catalog-images.py')
optimizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(optimizer)

class ImageQualityTests(unittest.TestCase):
    def test_transparency_and_orientation_dimensions(self):
        source = Image.new('RGBA', (80, 120), (230, 20, 40, 90))
        encoded, metrics = optimizer.encode_variant(source, 'perceptual', 92, 38, .995)
        self.assertTrue(metrics['pixelLossless'])
        self.assertTrue(metrics['alphaExact'])
        self.assertEqual(optimizer.resized(source, 640).size, (80, 120))
        self.assertEqual(optimizer.resized(source, 60).size, (40, 60))

    def test_exif_orientation_and_original_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'original.jpg'
            source = Image.new('RGB', (120, 80), (20, 100, 180))
            exif = Image.Exif(); exif[274] = 6
            source.save(filename, 'JPEG', exif=exif)
            before = filename.read_bytes()
            normalized = optimizer.normalize_image(filename)
            self.assertEqual(normalized.size, (80, 120))
            self.assertEqual(filename.read_bytes(), before)

if __name__ == '__main__':
    unittest.main()
