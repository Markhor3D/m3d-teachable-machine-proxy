#!/usr/bin/env python3
"""
M3D Model Converter — TF.js export → TFLite for ESP32

Usage:
  python3 convert.py                          # uses m3d-model.json in current dir
  python3 convert.py /path/to/model.json      # specify model.json path
  python3 convert.py model.json --no-quantize # float32 instead of int8

Expects 3 files in the same directory as model.json:
  - <name>.json           (TF.js model topology)
  - <name>.weights.bin    (TF.js weights)
  - <name>_metadata.json  (labels + imageSize)

Outputs in the same directory:
  - <name>.tflite         (full model: input → MobileNet → classifier)
  - <name>_labels.txt     (one label per line)
"""

import argparse
import json
import os
import sys
import numpy as np

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'


def find_model_files(model_json_path):
    """Resolve all file paths from the model.json path."""
    d = os.path.dirname(os.path.abspath(model_json_path))
    base = os.path.basename(model_json_path).replace('.json', '')

    paths = {
        'model_json': os.path.join(d, base + '.json'),
        'weights_bin': os.path.join(d, base + '.weights.bin'),
        'metadata': os.path.join(d, base + '_metadata.json'),
        'tflite_out': os.path.join(d, base + '.tflite'),
        'labels_out': os.path.join(d, base + '_labels.txt'),
    }

    for key in ('model_json', 'weights_bin', 'metadata'):
        if not os.path.exists(paths[key]):
            print(f"Error: Missing {paths[key]}")
            sys.exit(1)

    return paths


def load_tfjs_weights(model_json_path, weights_bin_path):
    """Parse TF.js weights from model.json manifest + binary file."""
    with open(model_json_path) as f:
        manifest = json.load(f)['weightsManifest'][0]['weights']

    with open(weights_bin_path, 'rb') as f:
        raw = f.read()

    weights = {}
    offset = 0
    for w in manifest:
        dtype = np.float32 if w['dtype'] == 'float32' else np.int32
        size = int(np.prod(w['shape']))
        nbytes = size * np.dtype(dtype).itemsize
        weights[w['name']] = np.frombuffer(raw[offset:offset + nbytes], dtype=dtype).reshape(w['shape'])
        offset += nbytes
        print(f"  {w['name']} {w['shape']}")

    return weights


def build_full_model(weights, metadata):
    """Build complete pipeline: input → normalize → MobileNet → head."""
    import tensorflow as tf

    image_size = metadata['imageSize']
    labels = metadata['labels']
    num_classes = len(labels)

    # Determine feature size the head expects
    kernel_keys = sorted([k for k in weights if 'kernel' in k])
    expected_features = weights[kernel_keys[0]].shape[0]

    # Find the Keras MobileNet input size that produces matching features
    # (TF.js and Keras have different padding at non-standard sizes)
    mobilenet_size = None
    for candidate in [image_size, 64, 80, 96, 128, 160, 192, 224]:
        base = tf.keras.applications.MobileNet(
            input_shape=(candidate, candidate, 3),
            alpha=0.25, include_top=False, weights='imagenet',
        )
        t = tf.keras.Model(inputs=base.input, outputs=base.get_layer('conv_pw_13_relu').output)
        feat = t.output_shape[1] * t.output_shape[2] * t.output_shape[3]
        if feat == expected_features:
            mobilenet_size = candidate
            truncated = t
            break

    if mobilenet_size is None:
        print(f"Error: No MobileNet input size produces {expected_features} features")
        sys.exit(1)

    needs_resize = mobilenet_size != image_size
    if needs_resize:
        print(f"\nMobileNet internal size: {mobilenet_size}x{mobilenet_size} (resize from {image_size}x{image_size})")
    else:
        print(f"\nMobileNet at {mobilenet_size}x{mobilenet_size} — no resize needed")

    inp = tf.keras.Input(shape=(image_size, image_size, 3), dtype=tf.float32, name='input_image')
    x = inp
    if needs_resize:
        x = tf.keras.layers.Resizing(mobilenet_size, mobilenet_size)(x)
    x = tf.keras.layers.Rescaling(scale=1.0 / 127.5, offset=-1.0)(x)
    x = truncated(x, training=False)
    x = tf.keras.layers.Flatten()(x)

    bias_keys = sorted([k for k in weights if 'bias' in k])

    # First dense layer (with bias)
    d1_kernel = weights[kernel_keys[0]]
    d1_bias = weights[bias_keys[0]] if bias_keys else None
    x = tf.keras.layers.Dense(
        d1_kernel.shape[1], activation='relu',
        use_bias=d1_bias is not None, name='head_dense1'
    )(x)

    # Second dense layer (usually no bias)
    d2_kernel = weights[kernel_keys[1]]
    has_d2_bias = len(bias_keys) > 1
    d2_bias_val = weights[bias_keys[1]] if has_d2_bias else None
    x = tf.keras.layers.Dense(
        num_classes, activation='softmax',
        use_bias=has_d2_bias, name='head_dense2'
    )(x)

    model = tf.keras.Model(inputs=inp, outputs=x, name='m3d_classifier')

    # Set head weights
    w1 = [d1_kernel, d1_bias] if d1_bias is not None else [d1_kernel]
    model.get_layer('head_dense1').set_weights(w1)
    w2 = [d2_kernel, d2_bias_val] if has_d2_bias else [d2_kernel]
    model.get_layer('head_dense2').set_weights(w2)

    return model


def convert_to_tflite(model, image_size, quantize=True):
    """Convert Keras model to TFLite bytes."""
    import tensorflow as tf

    converter = tf.lite.TFLiteConverter.from_keras_model(model)

    if quantize:
        def representative_dataset():
            for _ in range(100):
                yield [np.random.randint(0, 256, (1, image_size, image_size, 3)).astype(np.float32)]

        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.representative_dataset = representative_dataset
        converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
        converter.inference_input_type = tf.uint8
        converter.inference_output_type = tf.uint8

    return converter.convert()


def main():
    parser = argparse.ArgumentParser(description='Convert M3D Trainer export to TFLite for ESP32')
    parser.add_argument('model', nargs='?', default='m3d-model.json',
                        help='Path to model.json (default: m3d-model.json)')
    parser.add_argument('--no-quantize', action='store_true',
                        help='Skip int8 quantization (larger file, float32)')
    args = parser.parse_args()

    paths = find_model_files(args.model)

    with open(paths['metadata']) as f:
        metadata = json.load(f)

    labels = metadata['labels']
    image_size = metadata['imageSize']
    quantize = not args.no_quantize

    print(f"Model:    {paths['model_json']}")
    print(f"Input:    {image_size}x{image_size} RGB")
    print(f"Classes:  {labels}")
    print(f"Quantize: {'int8' if quantize else 'float32'}")

    print("\nLoading head weights...")
    weights = load_tfjs_weights(paths['model_json'], paths['weights_bin'])

    model = build_full_model(weights, metadata)
    model.summary()

    # Quick sanity check
    test = np.random.randint(0, 256, (1, image_size, image_size, 3)).astype(np.float32)
    preds = model.predict(test, verbose=0)[0]
    print(f"\nSanity check: {dict(zip(labels, [f'{p:.3f}' for p in preds]))}")

    print(f"\nConverting to TFLite ({'int8' if quantize else 'float32'})...")
    tflite_bytes = convert_to_tflite(model, image_size, quantize)

    with open(paths['tflite_out'], 'wb') as f:
        f.write(tflite_bytes)

    with open(paths['labels_out'], 'w') as f:
        for label in labels:
            f.write(label + '\n')

    size_kb = os.path.getsize(paths['tflite_out']) / 1024
    print(f"\n{'='*50}")
    print(f"  {paths['tflite_out']}  ({size_kb:.0f} KB)")
    print(f"  {paths['labels_out']}")
    print(f"{'='*50}")
    print(f"Copy both files to your ESP32 SD card.")


if __name__ == '__main__':
    main()
