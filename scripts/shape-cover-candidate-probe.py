#!/usr/bin/env python3
"""M1 source-resolution candidate comparison; not the export-pixel gate."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


MAX_RADIUS = 8
MAX_AREA_RATIO = 1.35
MAX_WIDTH_RATIO = 1.16
MAX_HEIGHT_RATIO = 1.16


def parse_rect(value):
    parts = tuple(int(part) for part in value.split(','))
    if len(parts) != 4 or parts[2] <= 0 or parts[3] <= 0:
        raise argparse.ArgumentTypeError('placement must be x,y,width,height')
    return parts


def bounding_size(mask):
    x, y, width, height = cv2.boundingRect(mask)
    if width == 0 or height == 0:
        raise ValueError('empty candidate alpha')
    return width, height


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mask-dir', required=True, type=Path)
    parser.add_argument('--asset', required=True, action='append', type=Path)
    parser.add_argument('--placement', required=True, type=parse_rect)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    record = json.loads((args.mask_dir / 'result.json').read_text())
    if record['status'] != 'CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW':
        parser.error('source mask candidate was rejected')
    width, height = record['decodedSize']
    left, top, right, bottom = record['mask']['bboxHalfOpen']
    mw, mh = record['mask']['size']
    packed = (args.mask_dir / 'candidate-mask.bitset').read_bytes()
    if len(packed) != (mw * mh + 7) // 8 or hashlib.sha256(packed).hexdigest() != record['mask']['packedSha256']:
        parser.error('source mask bitset is damaged')
    bits = np.unpackbits(np.frombuffer(packed, dtype=np.uint8), bitorder='little')
    if bits[mw * mh:].any():
        parser.error('source mask has nonzero padding')
    old = np.zeros((height, width), np.uint8)
    old[top:bottom, left:right] = bits[:mw * mh].reshape(mh, mw)
    px, py, pw, ph = args.placement
    if px < 0 or py < 0 or px + pw > width or py + ph > height:
        parser.error('placement is outside source pixels')

    report = {'maskSha256': record['mask']['packedSha256'], 'sourceSha256': record['sourceSha256'], 'limits': {'radiusPx': MAX_RADIUS, 'areaRatio': MAX_AREA_RATIO, 'widthRatio': MAX_WIDTH_RATIO, 'heightRatio': MAX_HEIGHT_RATIO}, 'candidates': []}
    for asset_path in args.asset:
        asset = Image.open(asset_path).convert('RGBA')
        asset.thumbnail((pw, ph), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        canvas.alpha_composite(asset, (px + (pw - asset.width) // 2, py + (ph - asset.height) // 2))
        alpha = np.asarray(canvas.getchannel('A'))
        visual_pixels = int((alpha > 0).sum())
        base = (alpha >= 250).astype(np.uint8)
        base_width, base_height = bounding_size(base)
        attempts = []
        for radius in range(MAX_RADIUS + 1):
            grown = base if radius == 0 else cv2.dilate(base, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)))
            grown_width, grown_height = bounding_size(grown)
            residual = int((old & (1 - grown)).sum())
            area_ratio = float(grown.sum() / visual_pixels)
            width_ratio = grown_width / base_width
            height_ratio = grown_height / base_height
            attempts.append({'radiusPx': radius, 'residualPx': residual, 'areaRatio': round(area_ratio, 5), 'widthRatio': round(width_ratio, 5), 'heightRatio': round(height_ratio, 5), 'withinLimits': area_ratio <= MAX_AREA_RATIO and width_ratio <= MAX_WIDTH_RATIO and height_ratio <= MAX_HEIGHT_RATIO})
        first_full = next((item for item in attempts if item['residualPx'] == 0), None)
        first_safe = next((item for item in attempts if item['residualPx'] == 0 and item['withinLimits']), None)
        report['candidates'].append({'asset': str(asset_path), 'assetSha256': hashlib.sha256(asset_path.read_bytes()).hexdigest(), 'visualPixels': visual_pixels, 'firstFull': first_full, 'firstWithinLimitsAndFull': first_safe, 'attempts': attempts})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    for candidate in report['candidates']:
        print(json.dumps({'asset': candidate['asset'], 'firstFull': candidate['firstFull'], 'firstWithinLimitsAndFull': candidate['firstWithinLimitsAndFull']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
