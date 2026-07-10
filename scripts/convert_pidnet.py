"""
Convert PIDNet-S (CVPR 2023) from PyTorch to TFLite for react-native-fast-tflite.

References:
  Paper:  https://arxiv.org/abs/2206.02066
  Repo:   https://github.com/XuJiacong/PIDNet
  Classes: 19 Cityscapes classes (road, sidewalk, person, car, bus, ...)

Steps:
  1. Download PIDNet-S_Cityscapes_val.pt from the PIDNet GitHub releases / Google Drive
     (linked in the README at https://github.com/XuJiacong/PIDNet)
     → Place it as:  scripts/PIDNet-S_Cityscapes_val.pt

  2. Run:  python scripts/convert_pidnet.py

  3. Model is copied to assets/models/pidnet_s.tflite automatically.

  4. Then:  npx expo start --clear

Conversion chain:
  PyTorch (.pt) → ONNX (opset 11) → simplified ONNX → TFLite (float32)

Output tensor:
  Input:  [1, INPUT_H, INPUT_W, 3]  float32  NHWC  (ImageNet-normalized)
  Output: [1, INPUT_H, INPUT_W]     int32         (per-pixel Cityscapes class 0-18)
          OR [1, INPUT_H, INPUT_W, 19] float32 (logits — lib/pidnet.ts handles both)
"""

import os, sys, shutil, subprocess
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
# Use 128×256 for mobile — PIDNet-S has stride-8 head, so internal features
# are 16×32, which is still enough for road/sidewalk/crosswalk classification.
INPUT_H = 128
INPUT_W = 256
NUM_CLASSES = 19

SCRIPTS_DIR = Path(__file__).parent
ROOT_DIR    = SCRIPTS_DIR.parent
PIDNET_DIR  = SCRIPTS_DIR / 'PIDNet'
WEIGHTS     = SCRIPTS_DIR / 'PIDNet_S_Cityscapes_val.pt'
OUT_DIR     = ROOT_DIR / 'assets' / 'models'
ONNX_RAW    = PIDNET_DIR / 'pidnet_s_raw.onnx'
ONNX_SIMP   = PIDNET_DIR / 'pidnet_s.onnx'
TFLITE_DIR  = PIDNET_DIR / 'tflite_out'

# ── Helpers ───────────────────────────────────────────────────────────────────
def pip(*packages):
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', *packages, '-q'])

def check_weights():
    if not WEIGHTS.exists():
        print(f'\nERROR: Weights not found at:\n  {WEIGHTS}\n')
        print('Download PIDNet-S_Cityscapes_val.pt from the PIDNet GitHub README:')
        print('  https://github.com/XuJiacong/PIDNet')
        print('  → "Pretrained models" → Cityscapes → PIDNet-S (val)')
        print(f'\nThen place the file here:\n  {WEIGHTS}\n')
        sys.exit(1)

# ── Step 1: Install ───────────────────────────────────────────────────────────
def install_deps():
    print('[1/5] Installing Python dependencies...')
    pip('torch', 'torchvision', '--index-url', 'https://download.pytorch.org/whl/cpu')
    pip('onnx>=1.14')
    # onnx-simplifier ships pre-built wheels → installs 'onnxsim' module
    # without needing cmake. Must come BEFORE onnx2tf so pip doesn't try to
    # build onnxsim from source when resolving onnx2tf's dependencies.
    pip('onnx-simplifier>=0.4')
    pip('tf-keras')                 # pulls in tensorflow
    pip('flatbuffers>=23.5.26')     # required by onnx2tf at runtime
    pip('ai-edge-litert')           # TFLite runtime (replaces tflite-runtime)
    # --no-deps: skip onnx2tf's own dep resolution entirely — all deps
    # (onnx, tensorflow, onnxsim, flatbuffers, ai-edge-litert) already above.
    pip('onnx2tf>=1.17', '--no-deps')

# ── Step 2: Clone PIDNet ──────────────────────────────────────────────────────
def clone_pidnet():
    print('[2/5] Cloning PIDNet repository...')
    if not PIDNET_DIR.exists():
        subprocess.check_call([
            'git', 'clone', '--depth', '1',
            'https://github.com/XuJiacong/PIDNet',
            str(PIDNET_DIR),
        ])
    else:
        print('       (already cloned, skipping)')

# ── Step 3: Load model ────────────────────────────────────────────────────────
def load_model():
    import torch
    sys.path.insert(0, str(PIDNET_DIR))
    from models import pidnet as pidnet_module

    print(f'[3/5] Loading PIDNet-S weights from {WEIGHTS.name}...')
    model = pidnet_module.get_pred_model('pidnet-s', NUM_CLASSES)

    state = torch.load(str(WEIGHTS), map_location='cpu')
    # Unwrap common checkpoint wrappers
    if 'state_dict' in state:
        state = state['state_dict']
    elif 'model' in state:
        state = state['model']
    # Strip 'model.' or 'module.' prefixes that appear in some checkpoints
    state = {k.replace('module.', '').replace('model.', ''): v for k, v in state.items()}

    model.load_state_dict(state, strict=False)
    model.eval()
    print(f'       Model loaded ({sum(p.numel() for p in model.parameters()):,} params)')
    return model

# ── Step 4: Export to ONNX ───────────────────────────────────────────────────
def export_onnx(model):
    import torch

    print(f'[4/5] Exporting to ONNX (input {INPUT_H}×{INPUT_W})...')

    # Export raw float32 logits [B, 19, H, W] — NO ArgMax wrapper.
    # ArgMax produces int64/int32 which causes type errors in TFLite CONV_2D.
    # onnx2tf will transpose NCHW → NHWC automatically → output [B, H, W, 19].
    # lib/pidnet.ts toMask() handles float32 logits via argmax in JS.

    model.eval()
    dummy = torch.zeros(1, 3, INPUT_H, INPUT_W)

    with torch.no_grad():
        sample_out = model(dummy)
        if isinstance(sample_out, (list, tuple)):
            sample_out = sample_out[0]
        print(f'       Model output shape (PyTorch): {tuple(sample_out.shape)}')

    class PIDNetLogits(torch.nn.Module):
        """Strips auxiliary heads — returns only the main segmentation logits."""
        def __init__(self, backbone):
            super().__init__()
            self.backbone = backbone

        def forward(self, x):
            out = self.backbone(x)
            if isinstance(out, (list, tuple)):
                out = out[0]
            return out  # [B, 19, H, W] float32

    wrapped = PIDNetLogits(model)
    wrapped.eval()

    torch.onnx.export(
        wrapped,
        dummy,
        str(ONNX_RAW),
        opset_version=11,
        input_names=['image'],
        output_names=['logits'],
        dynamic_axes={
            'image':  {0: 'batch'},
            'logits': {0: 'batch'},
        },
        do_constant_folding=True,
    )
    print(f'       ONNX exported → {ONNX_RAW.name}')

    # Simplify: fuses constant subgraphs, removes unused nodes
    try:
        import onnx
        from onnxsim import simplify
        model_onnx = onnx.load(str(ONNX_RAW))
        simplified, ok = simplify(model_onnx)
        if ok:
            onnx.save(simplified, str(ONNX_SIMP))
            print(f'       ONNX simplified → {ONNX_SIMP.name}')
            return ONNX_SIMP
        else:
            print('       (simplification skipped — using raw ONNX)')
            return ONNX_RAW
    except Exception as e:
        print(f'       (simplification failed: {e} — using raw ONNX)')
        return ONNX_RAW

# ── Step 5: Convert to TFLite ─────────────────────────────────────────────────
def convert_tflite(onnx_path: Path) -> Path:
    print('[5/5] Converting ONNX → TFLite...')
    TFLITE_DIR.mkdir(parents=True, exist_ok=True)

    # onnx2tf: transposes NCHW→NHWC, converts all ops to TFLite-compatible ones
    result = subprocess.run(
        [
            sys.executable, '-m', 'onnx2tf',
            '-i', str(onnx_path),
            '-o', str(TFLITE_DIR),
            '-nuo',   # no-use-onnx-1-dim-optimization (keeps batch dim)
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print('onnx2tf stderr:\n', result.stderr[-2000:])
        raise RuntimeError('TFLite conversion failed — see errors above')

    tflites = sorted(TFLITE_DIR.glob('*.tflite'))
    if not tflites:
        raise FileNotFoundError(f'No .tflite found in {TFLITE_DIR}')
    return tflites[0]

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    check_weights()
    install_deps()
    clone_pidnet()
    model   = load_model()
    onnx_p  = export_onnx(model)
    tflite  = convert_tflite(onnx_p)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dst = OUT_DIR / 'pidnet_s.tflite'
    shutil.copy(tflite, dst)
    size_kb = dst.stat().st_size // 1024

    print(f'\nDone!  →  {dst}')
    print(f'Size:      {size_kb} KB')
    print(f'Input:     [1, {INPUT_H}, {INPUT_W}, 3]  float32  (ImageNet-normalized NHWC)')
    print(f'Output:    [1, {INPUT_H}, {INPUT_W}, 19]  float32 (Cityscapes logits → argmax in lib/pidnet.ts)')
    print()
    print('Next:')
    print('  npx expo start --clear')
    print('  npx expo run:android')
