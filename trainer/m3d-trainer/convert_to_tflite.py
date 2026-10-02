"""
Convert exported M3D Trainer model (TF.js head) into a standalone TFLite file.

Builds the full pipeline:
  96x96 RGB input -> resize to 224x224 -> normalize [-1,1] -> MobileNet V1 0.25 -> head -> softmax

Outputs: m3d-model.tflite (int8 quantized)
"""

import json
import os
import struct
import numpy as np

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import tensorflow as tf

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
TFJS_MODEL_PATH = os.path.join(MODEL_DIR, 'm3d-model.json')
WEIGHTS_PATH = os.path.join(MODEL_DIR, 'm3d-model.weights.bin')
METADATA_PATH = os.path.join(MODEL_DIR, 'm3d-model_metadata.json')
OUTPUT_PATH = os.path.join(MODEL_DIR, 'm3d-model.tflite')
IMAGE_SIZE = 96


def load_tfjs_weights(model_json_path, weights_bin_path):
    """Load weights from TF.js format (model.json + weights.bin)."""
    with open(model_json_path) as f:
        model_json = json.load(f)

    manifest = model_json['weightsManifest'][0]['weights']

    with open(weights_bin_path, 'rb') as f:
        raw = f.read()

    weights = {}
    offset = 0
    for w in manifest:
        name = w['name']
        shape = w['shape']
        dtype = w['dtype']
        np_dtype = np.float32 if dtype == 'float32' else np.int32
        size = int(np.prod(shape))
        byte_size = size * np.dtype(np_dtype).itemsize
        arr = np.frombuffer(raw[offset:offset + byte_size], dtype=np_dtype).reshape(shape)
        weights[name] = arr
        offset += byte_size
        print(f"  Loaded weight: {name} {shape}")

    return weights


def main():
    with open(METADATA_PATH) as f:
        metadata = json.load(f)

    labels = metadata['labels']
    num_classes = len(labels)
    print(f"Labels: {labels}")
    print(f"Input: {IMAGE_SIZE}x{IMAGE_SIZE} -> Model output: {num_classes} classes")

    # 1. Load head weights from TF.js export
    print("\nLoading TF.js head weights...")
    weights = load_tfjs_weights(TFJS_MODEL_PATH, WEIGHTS_PATH)

    # 2. Load MobileNet V1 alpha=0.25 truncated at conv_pw_13_relu
    print("\nLoading MobileNet V1 0.25...")
    base = tf.keras.applications.MobileNet(
        input_shape=(224, 224, 3),
        alpha=0.25,
        include_top=False,
        weights='imagenet',
    )
    truncation_layer = base.get_layer('conv_pw_13_relu')
    truncated = tf.keras.Model(inputs=base.input, outputs=truncation_layer.output)

    # 3. Build full pipeline
    print("\nBuilding full pipeline...")
    inp = tf.keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), dtype=tf.float32, name='input_image')
    x = tf.keras.layers.Resizing(224, 224)(inp)
    x = tf.keras.layers.Rescaling(scale=1.0 / 127.5, offset=-1.0)(x)
    x = truncated(x, training=False)
    x = tf.keras.layers.Flatten()(x)

    # Rebuild head with loaded weights
    dense1_kernel = weights['dense_Dense1/kernel']
    dense1_bias = weights['dense_Dense1/bias']
    dense2_kernel = weights['dense_Dense2/kernel']

    x = tf.keras.layers.Dense(
        dense1_kernel.shape[1], activation='relu', use_bias=True,
        name='head_dense1'
    )(x)
    x = tf.keras.layers.Dense(
        num_classes, activation='softmax', use_bias=False,
        name='head_dense2'
    )(x)

    full_model = tf.keras.Model(inputs=inp, outputs=x, name='m3d_classifier')

    # Set head weights
    full_model.get_layer('head_dense1').set_weights([dense1_kernel, dense1_bias])
    full_model.get_layer('head_dense2').set_weights([dense2_kernel])

    full_model.summary()

    # 4. Verify with a test input
    test_input = np.random.randint(0, 256, (1, IMAGE_SIZE, IMAGE_SIZE, 3)).astype(np.float32)
    preds = full_model.predict(test_input, verbose=0)
    print(f"\nTest prediction: {dict(zip(labels, preds[0].tolist()))}")

    # 5. Convert to TFLite with int8 quantization
    print("\nConverting to TFLite (int8 quantized)...")

    def representative_dataset():
        for _ in range(100):
            yield [np.random.randint(0, 256, (1, IMAGE_SIZE, IMAGE_SIZE, 3)).astype(np.float32)]

    converter = tf.lite.TFLiteConverter.from_keras_model(full_model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.uint8
    converter.inference_output_type = tf.uint8

    tflite_model = converter.convert()

    with open(OUTPUT_PATH, 'wb') as f:
        f.write(tflite_model)

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"\nSaved: {OUTPUT_PATH}")
    print(f"Size: {size_kb:.1f} KB")

    # 6. Save labels for ESP32
    labels_path = os.path.join(MODEL_DIR, 'm3d-model_labels.txt')
    with open(labels_path, 'w') as f:
        for label in labels:
            f.write(label + '\n')
    print(f"Labels: {labels_path}")
    print(f"\nCopy m3d-model.tflite + m3d-model_labels.txt to your ESP32 SD card.")


if __name__ == '__main__':
    main()
