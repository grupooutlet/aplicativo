#!/usr/bin/env python3
"""Prepare immutable WebP variants from existing local originals; never downloads or uploads.

Install scripts/image-optimization-requirements.txt in a virtual environment first.
The generated manifest and upload plan are local review artifacts, not a database update.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import time
import warnings

try:
    from PIL import Image, ImageChops, ImageCms, ImageOps, features
except ImportError:
    raise SystemExit("Install the pinned requirements: python -m pip install -r scripts/image-optimization-requirements.txt")

PROFILES = {"thumb": 160, "card": 640, "detail": 1280, "banner": 2400}
TARGET_PREFIX = "https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/"
VERSION = "webp-v1-dimensions"
Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def normalize_image(path: Path) -> Image.Image:
    with Image.open(path) as opened:
        if getattr(opened, "n_frames", 1) != 1:
            raise ValueError("Animated image retained unchanged; it needs separate review")
        opened.load()
        image = ImageOps.exif_transpose(opened)
        alpha = "A" in image.getbands() or (image.mode == "P" and "transparency" in image.info)
        output_mode = "RGBA" if alpha else "RGB"
        profile = opened.info.get("icc_profile")
        if profile:
            try:
                image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile("sRGB"), outputMode=output_mode)
            except (ImageCms.PyCMSError, OSError, ValueError) as error:
                raise ValueError("Invalid color profile; original retained for review") from error
        else:
            image = image.convert(output_mode)
        return image.copy()


def resized(image: Image.Image, maximum: int) -> Image.Image:
    scale = min(1, maximum / max(image.size))
    size = tuple(max(1, math.floor(n * scale + .5)) for n in image.size)
    return image.resize(size, Image.Resampling.LANCZOS, reducing_gap=3.0) if size != image.size else image.copy()


def histogram_moments(image: Image.Image) -> tuple[float, float]:
    histogram = image.histogram()
    count = sum(histogram)
    mean = sum(i * n for i, n in enumerate(histogram)) / count
    variance = sum(i * i * n for i, n in enumerate(histogram)) / count - mean * mean
    return mean, max(0.0, variance)


def quality_metrics(reference: Image.Image, encoded: Image.Image) -> dict:
    """Exact RGB PSNR and global luminance SSIM. Visual QA remains necessary."""
    if reference.size != encoded.size:
        raise ValueError("Encoder changed the expected image dimensions")
    a, b = reference.convert("RGB"), encoded.convert("RGB")
    histogram = ImageChops.difference(a, b).histogram()
    count = reference.width * reference.height * 3
    mse = sum((i % 256) ** 2 * n for i, n in enumerate(histogram)) / count
    psnr = None if mse == 0 else 10 * math.log10(255 ** 2 / mse)
    la, lb = a.convert("L"), b.convert("L")
    ma, va = histogram_moments(la)
    mb, vb = histogram_moments(lb)
    difference = ImageChops.difference(la, lb).histogram()
    lum_mse = sum(i * i * n for i, n in enumerate(difference)) / (a.width * a.height)
    covariance = (va + vb + (ma - mb) ** 2 - lum_mse) / 2
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ssim = ((2 * ma * mb + c1) * (2 * covariance + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    alpha_equal = reference.mode != "RGBA" or ImageChops.difference(reference.getchannel("A"), encoded.convert("RGBA").getchannel("A")).getbbox() is None
    return {"psnrDb": round(psnr, 4) if psnr is not None else None, "globalSsim": round(max(-1, min(1, ssim)), 6), "alphaExact": alpha_equal, "pixelLossless": mse == 0 and alpha_equal}


def encode_variant(image: Image.Image, mode: str, quality: int, minimum_psnr: float, minimum_ssim: float) -> tuple[bytes, dict]:
    # Transparent source images are encoded losslessly to preserve edges and alpha.
    lossless = mode == "lossless" or image.mode == "RGBA"
    qualities = [quality] if lossless else sorted(set([quality, max(quality, 95), max(quality, 98), 100]))
    for q in qualities:
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=q, lossless=lossless, method=4, exact=True)
        content = buffer.getvalue()
        with Image.open(io.BytesIO(content)) as decoded:
            decoded.load()
            metrics = quality_metrics(image, decoded)
        if metrics["alphaExact"] and (metrics["pixelLossless"] or (metrics["psnrDb"] >= minimum_psnr and metrics["globalSsim"] >= minimum_ssim)):
            return content, {**metrics, "encoderQuality": q, "encoding": "lossless" if lossless else "high-fidelity"}
    # The quality gate takes precedence over savings. Such origins can remain inactive.
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", lossless=True, quality=100, method=4, exact=True)
    return buffer.getvalue(), {"psnrDb": None, "globalSsim": 1, "alphaExact": True, "pixelLossless": True, "encoderQuality": 100, "encoding": "lossless-fallback"}


def process_one(job: dict, source_dir: Path, output_dir: Path, options) -> dict:
    source_url, record = job["sourceUrl"], job["record"]
    local_name = hashlib.sha256(source_url.encode()).hexdigest()[:32] + ".image"
    local = (source_dir / local_name).resolve()
    if not local.is_relative_to(source_dir) or not local.is_file():
        return {"originalUrl": record.get("url"), "error": "Local original unavailable; needs download after service recovery"}
    original_url = record.get("url", "")
    if not original_url.startswith(TARGET_PREFIX) or record.get("object") != original_url.removeprefix(TARGET_PREFIX):
        return {"originalUrl": original_url, "error": "Unexpected destination mapping; original retained"}
    original_bytes = local.stat().st_size
    if original_bytes != record.get("bytes"):
        return {"originalUrl": original_url, "error": "Local file differs from recorded byte length; review before upload"}
    digest = sha256(local)
    cache_path = output_dir / "records" / (digest + ".json")
    policy = {"version": VERSION, "mode": options.mode, "quality": options.quality, "minimumPsnr": options.min_psnr, "minimumGlobalSsim": options.min_ssim, "profiles": PROFILES}
    if not options.rebuild and cache_path.exists():
        previous = json.loads(cache_path.read_text(encoding="utf-8"))
        if previous.get("policy") == policy and previous.get("originalUrl") == original_url and all((output_dir / v["file"]).is_file() and (output_dir / v["file"]).stat().st_size == v["bytes"] for v in previous.get("variants", {}).values()) and len(previous.get("variants", {})) == len(PROFILES):
            return previous
    try:
        image = normalize_image(local)
        variants = {}
        # Equivalent native dimensions are encoded once, then reused locally under the fixed contract.
        dimension_cache = {}
        for profile, maximum in PROFILES.items():
            reference = resized(image, maximum)
            if reference.size not in dimension_cache:
                dimension_cache[reference.size] = encode_variant(reference, options.mode, options.quality, options.min_psnr, options.min_ssim)
            content, metrics = dimension_cache[reference.size]
            object_name = f"products/optimized-v1/{digest}-{image.width}x{image.height}-{profile}.webp"
            relative = f"images/{digest}-{image.width}x{image.height}-{profile}.webp"
            target = output_dir / relative
            temporary = target.with_suffix(".webp.tmp")
            temporary.write_bytes(content)
            os.replace(temporary, target)
            variants[profile] = {"object": object_name, "url": TARGET_PREFIX + object_name, "file": relative, "width": reference.width, "height": reference.height, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), **metrics}
        recommended = any(variant["bytes"] < original_bytes for variant in variants.values())
        result = {"originalUrl": original_url, "originalObject": record["object"], "sourceUrl": source_url, "sourceFile": local_name, "sourceSha256": digest, "originalBytes": original_bytes, "originalWidth": image.width, "originalHeight": image.height, "recommended": recommended, "mask": sum(1 << i for i, profile in enumerate(PROFILES) if variants[profile]["bytes"] < original_bytes), "reason": "quality-passed-use-smaller-profiles-original-for-others" if recommended else "retained-original-until-size-review", "variants": variants, "policy": policy}
        atomic_json(cache_path, result)
        return result
    except (OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        return {"originalUrl": original_url, "error": str(error)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("imports/2026-10-15-forte/asset-manifest.json"))
    parser.add_argument("--source-dir", type=Path, default=Path("imports/2026-10-15-forte/images"))
    parser.add_argument("--output-dir", type=Path, default=Path("test-results/catalog-optimized"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0, help="0 processes the entire local manifest")
    parser.add_argument("--quality", type=int, default=92)
    parser.add_argument("--min-psnr", type=float, default=38)
    parser.add_argument("--min-ssim", type=float, default=0.995)
    parser.add_argument("--mode", choices=["perceptual", "lossless"], default="perceptual")
    parser.add_argument("--rebuild", action="store_true")
    options = parser.parse_args(argv)
    if not features.check("webp"):
        parser.error("Pillow was built without WebP support")
    if not 1 <= options.workers <= 12 or not 1 <= options.quality <= 100 or not 20 <= options.min_psnr <= 60 or not 0.9 <= options.min_ssim <= 1:
        parser.error("Invalid worker or quality limits")
    source_dir, output_dir = options.source_dir.resolve(), options.output_dir.resolve()
    if output_dir == source_dir or output_dir.is_relative_to(source_dir) or source_dir.is_relative_to(output_dir):
        parser.error("Output must be separate from the original source directory")
    manifest = json.loads(options.manifest.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        parser.error("Expected original import asset manifest keyed by source URL")
    jobs = [{"sourceUrl": source, "record": record} for source, record in sorted(manifest.items())]
    if options.limit:
        jobs = jobs[:options.limit]
    (output_dir / "images").mkdir(parents=True, exist_ok=True)
    (output_dir / "records").mkdir(exist_ok=True)
    started = time.monotonic()
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=options.workers) as pool:
        futures = [pool.submit(process_one, job, source_dir, output_dir, options) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            if len(results) % 50 == 0 or len(results) == len(jobs):
                print(json.dumps({"completed": len(results), "total": len(jobs), "elapsedSeconds": round(time.monotonic() - started, 1)}), flush=True)
    results.sort(key=lambda row: row.get("originalUrl", ""))
    good = [row for row in results if "variants" in row]
    for row in good:
        row["recommended"] = any(v["bytes"] < row["originalBytes"] for v in row["variants"].values())
    recommended = [row for row in good if row["recommended"]]
    totals = {profile: sum(row["variants"][profile]["bytes"] for row in good) for profile in PROFILES}
    original_bytes = sum(row["originalBytes"] for row in good)
    summary = {"version": VERSION, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sourceCount": len(jobs), "completeCount": len(good), "recommendedCount": len(recommended), "retainedOriginalCount": len(good) - len(recommended), "errorCount": len(results) - len(good), "originalBytes": original_bytes, "variantBytes": totals, "variantSavingsPercent": {p: round(100 * (1 - n / original_bytes), 2) if original_bytes else 0 for p, n in totals.items()}, "recommendedOriginalBytes": sum(row["originalBytes"] for row in recommended), "recommendedVariantBytes": {profile: sum(row["variants"][profile]["bytes"] for row in recommended) for profile in PROFILES}, "preparedStorageBytes": sum(totals.values()), "elapsedSeconds": round(time.monotonic() - started, 1), "originalsModified": False, "uploadsPerformed": 0, "qualityNote": "RGB PSNR and global luminance SSIM are deterministic quality gates, not a guarantee of imperceptibility; review samples before activating."}
    atomic_json(output_dir / "manifest.json", {"summary": summary, "images": good, "errors": [row for row in results if "error" in row]})
    upload_rows = []
    for row in good:
        mask, seen = 0, set()
        for i, profile in enumerate(PROFILES):
            v = row["variants"][profile]
            if v["bytes"] < row["originalBytes"] and v["sha256"] not in seen:
                mask |= 1 << i
                seen.add(v["sha256"])
        files = [{**v, "profile": p, "contentType": "image/webp", "cacheControl": "31536000, immutable", "upsert": False} for i, (p, v) in enumerate(row["variants"].items()) if mask & (1 << i)]
        activation = row["originalUrl"] + f"#media-v1={row['sourceSha256']}:{row['originalWidth']}:{row['originalHeight']}:{mask}"
        upload_rows.append({"originalUrl": row["originalUrl"], "sourceSha256": row["sourceSha256"], "recommended": bool(mask), "activationUrl": activation, "requiresAllProfiles": [f["profile"] for f in files], "files": files})
    summary["beneficialCount"] = sum(1 for row in upload_rows if row["recommended"])
    summary["uploadBytes"] = sum(f["bytes"] for row in upload_rows for f in row["files"])
    summary["effectiveVariantBytes"] = {profile: sum(min(row["variants"][profile]["bytes"], row["originalBytes"]) for row in good) for profile in PROFILES}
    summary["effectiveSavingsPercent"] = {p: round(100 * (1 - n / original_bytes), 2) for p, n in summary["effectiveVariantBytes"].items()}
    atomic_json(output_dir / "manifest.json", {"summary": summary, "images": good, "errors": [row for row in results if "error" in row]})
    atomic_json(output_dir / "upload-plan.json", {"status": "prepared-not-uploaded", "bucket": "product-photos", "project": "rwxqytomiorsrxpgtjin", "policy": "Do not activate an origin until all declared profiles have been uploaded and verified; larger variants are not uploaded or referenced. On HTTP 402 stop; never bypass provider restriction. Never overwrite original objects.", "images": upload_rows})
    with (output_dir / "report.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(["original_url", "original_bytes", "recommended", *[p + "_bytes" for p in PROFILES], *[p + "_width" for p in PROFILES], *[p + "_psnr_db" for p in PROFILES]])
        for row in good:
            writer.writerow([row["originalUrl"], row["originalBytes"], row["recommended"], *[row["variants"][p]["bytes"] for p in PROFILES], *[row["variants"][p]["width"] for p in PROFILES], *[row["variants"][p]["psnrDb"] for p in PROFILES]])
    atomic_json(output_dir / "summary.json", summary)
    print(json.dumps(summary), flush=True)
    return 1 if summary["errorCount"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
