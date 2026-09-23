#!/usr/bin/env python3
"""Local M1 evidence probe; candidates require human edge review before use."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def parse_rect(value):
    parts = tuple(int(part) for part in value.split(','))
    if len(parts) != 4 or parts[2] <= 0 or parts[3] <= 0:
        raise argparse.ArgumentTypeError('ROI must be x,y,width,height')
    return parts


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--roi', required=True, type=parse_rect)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--sample-every', type=int, default=30)
    parser.add_argument('--start-frame', type=int, default=0)
    parser.add_argument('--end-frame', type=int)
    parser.add_argument('--edge-sheet-every', type=int, default=0)
    args = parser.parse_args()
    if args.sample_every < 1 or args.start_frame < 0 or args.edge_sheet_every < 0:
        parser.error('frame indices and sample interval must be nonnegative')
    args.output.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(args.source))
    if not capture.isOpened():
        parser.error('source cannot be decoded')
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = capture.get(cv2.CAP_PROP_FPS)
    x, y, w, h = args.roi
    if x < 0 or y < 0 or x + w > width or y + h > height or w * h > 30000:
        parser.error('ROI is outside decoded source or exceeds probe limit')

    samples = []
    sample_indices = []
    frames = 0
    while True:
        ok, frame = capture.read()
        if not ok or (args.end_frame is not None and frames >= args.end_frame):
            break
        if frames >= args.start_frame and (frames - args.start_frame) % args.sample_every == 0:
            samples.append(frame[y:y + h, x:x + w].copy())
            sample_indices.append(frames)
            if len(samples) > 512:
                parser.error('probe is limited to 512 sampled frames')
        frames += 1
    capture.release()

    result = {
        'status': 'REJECT',
        'reason': None,
        'sourceSha256': sha256(args.source),
        'sourceBytes': args.source.stat().st_size,
        'decodedSize': [width, height],
        'fps': fps,
        'roi': [x, y, w, h],
        'frameRange': [args.start_frame, frames],
        'sampleEvery': args.sample_every,
        'sampleFrames': sample_indices,
        'decodedFrames': frames,
        'method': 'temporal-max-channel-std-lt20-largest-8-connected-component-dilate-3-v1',
    }
    if len(samples) < 3 or sample_indices[-1] - sample_indices[0] < fps:
        result['reason'] = 'INSUFFICIENT_TIME_EVIDENCE'
    else:
        stack = np.stack(samples).astype(np.float32)
        stable = (stack.std(axis=0).max(axis=2) < 20).astype(np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(stable, 8)
        if count <= 1:
            result['reason'] = 'NO_STABLE_COMPONENT'
        else:
            component = max(range(1, count), key=lambda index: stats[index, cv2.CC_STAT_AREA])
            bx, by, bw, bh, area = [int(value) for value in stats[component]]
            result['stableComponent'] = [x + bx, y + by, bw, bh, area]
            if area < 1000:
                result['reason'] = 'NO_SIZED_STABLE_COMPONENT'
            elif bx == 0 or by == 0 or bx + bw == w or by + bh == h:
                result['reason'] = 'ROI_TRUNCATES_COMPONENT'
            else:
                raw = (labels == component).astype(np.uint8)
                mask = cv2.dilate(raw, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
                core = cv2.erode(raw, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(bool)
                if core.sum() < 100:
                    result['reason'] = 'INSUFFICIENT_STATIC_CORE'
                else:
                    reference = np.median(stack, axis=0)
                    capture = cv2.VideoCapture(str(args.source))
                    worst = {'frame': None, 'meanMaxChannelDifference': -1.0}
                    checked = 0
                    index = 0
                    while index < frames:
                        ok, frame = capture.read()
                        if not ok:
                            break
                        if index >= args.start_frame:
                            difference = np.abs(frame[y:y + h, x:x + w].astype(np.float32) - reference)
                            mean = float(difference.max(axis=2)[core].mean())
                            if mean > worst['meanMaxChannelDifference']:
                                worst = {'frame': index, 'meanMaxChannelDifference': round(mean, 3)}
                            checked += 1
                        index += 1
                    capture.release()
                    result['temporalCore'] = {'checkedFrames': checked, 'worst': worst, 'limit': 40}
                    if checked != frames - args.start_frame or worst['meanMaxChannelDifference'] > 40:
                        result['reason'] = 'TEMPORAL_CORE_CONTRADICTION'
                    else:
                        ys, xs = np.nonzero(mask)
                        left, top, right, bottom = x + int(xs.min()), y + int(ys.min()), x + int(xs.max()) + 1, y + int(ys.max()) + 1
                        cropped = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
                        if cropped.size > 262144:
                            parser.error('mask exceeds 512x512 pixel-equivalent probe limit')
                        mask_path = args.output / 'candidate-mask.png'
                        Image.fromarray(cropped * 255).save(mask_path)
                        packed_path = args.output / 'candidate-mask.bitset'
                        packed_path.write_bytes(np.packbits(cropped.reshape(-1), bitorder='little').tobytes())
                        result['mask'] = {
                            'bboxHalfOpen': [left, top, right, bottom],
                            'size': [int(cropped.shape[1]), int(cropped.shape[0])],
                            'markedPixels': int(cropped.sum()),
                            'rawBitsSha256': hashlib.sha256(cropped.tobytes()).hexdigest(),
                            'packedFormat': 'bitpack-lsb-row-major-v1',
                            'packedBytes': packed_path.stat().st_size,
                            'packedSha256': sha256(packed_path),
                            'pngSha256': sha256(mask_path),
                        }
                        if args.edge_sheet_every:
                            sheet_frames = list(range(args.start_frame, frames, args.edge_sheet_every))
                            if len(sheet_frames) > 100:
                                parser.error('edge sheet is limited to 100 frames')
                            canvas = Image.new('RGB', (2600, 230 * ((len(sheet_frames) + 9) // 10)), 'white')
                            draw = ImageDraw.Draw(canvas)
                            edge = mask - cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
                            capture = cv2.VideoCapture(str(args.source))
                            for position, frame_index in enumerate(sheet_frames):
                                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                                ok, frame = capture.read()
                                if not ok:
                                    parser.error(f'cannot decode edge-sheet frame {frame_index}')
                                crop = cv2.cvtColor(frame[y:y + h, x:x + w], cv2.COLOR_BGR2RGB)
                                crop[edge.astype(bool)] = [255, 0, 255]
                                tile_x = position % 10 * 260
                                tile_y = position // 10 * 230
                                canvas.paste(Image.fromarray(crop).resize((260, 200)), (tile_x, tile_y + 25))
                                draw.text((tile_x + 3, tile_y + 3), str(frame_index), fill='black')
                            capture.release()
                            sheet_path = args.output / 'edge-contact-sheet.png'
                            canvas.save(sheet_path)
                            result['edgeSheet'] = {'frames': sheet_frames, 'sha256': sha256(sheet_path)}
                        result['status'] = 'CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW'
    (args.output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'reason': result['reason'], 'component': result.get('stableComponent'), 'mask': result.get('mask'), 'temporalCore': result.get('temporalCore')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
