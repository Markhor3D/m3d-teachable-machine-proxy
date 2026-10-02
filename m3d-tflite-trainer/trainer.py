import base64
import io
import json
import os
import numpy as np
from PIL import Image

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

IMAGE_SIZE = 48
_truncated_model = None
_mobilenet_input_size = None


def _get_mobilenet():
    """
    Transfer Learning setup — instead of training a whole neural network from
    scratch (which needs millions of images), we take a pre-trained MobileNet
    that Google already trained on ImageNet (1.4M images, 1000 classes).

    We chop it at layer 'conv_pw_13_relu' — throwing away the final
    classification layers. What's left is a "feature extractor": it takes an
    image and outputs a vector of numbers that describe what it "sees"
    (edges, textures, shapes). Think of it as converting a photo into a
    fingerprint.

    alpha=0.25 means we use the smallest MobileNet variant (25% of channels).
    Smaller = faster on ESP32, and good enough for simple tasks like +/-/×.

    We cache it globally so it's only loaded once per server lifetime.
    """
    global _truncated_model, _mobilenet_input_size
    if _truncated_model is not None:
        return _truncated_model, _mobilenet_input_size

    import tensorflow as tf

    # Try input sizes starting from IMAGE_SIZE. MobileNet expects specific
    # sizes — some produce 0-dim outputs at small sizes, so we try larger
    # ones until we get valid features.
    for candidate in [IMAGE_SIZE, 64, 80, 96, 128, 160, 192, 224]:
        base = tf.keras.applications.MobileNet(
            input_shape=(candidate, candidate, 3),  # height, width, RGB
            alpha=0.25,        # width multiplier — 0.25 = smallest variant
            include_top=False, # throw away the 1000-class classifier head
            weights='imagenet',# use Google's pre-trained weights
        )
        # Chop: keep everything up to conv_pw_13_relu
        t = tf.keras.Model(
            inputs=base.input,
            outputs=base.get_layer('conv_pw_13_relu').output,
        )
        # Output shape is (batch, h, w, channels). Total features = h * w * channels.
        # e.g. at 48x48 input → output is (1, 1, 1, 256) → 256 features
        feat = t.output_shape[1] * t.output_shape[2] * t.output_shape[3]
        if feat > 0:
            _truncated_model = t
            _mobilenet_input_size = candidate
            print(f"MobileNet loaded: {candidate}x{candidate} -> {feat} features")
            return _truncated_model, _mobilenet_input_size

    raise RuntimeError("Failed to load MobileNet")


def decode_images(class_data):
    """
    Convert base64-encoded images (from the browser or ESP32) into numpy arrays.

    Each image becomes a 48×48×3 array of floats (height × width × RGB).
    numpy arrays are what TensorFlow/Keras expect as input — they're just
    multi-dimensional grids of numbers.
    """
    classes = []
    for cls in class_data:
        images = []
        for b64 in cls['images']:
            # Strip "data:image/jpeg;base64," prefix if present
            if ',' in b64:
                b64 = b64.split(',', 1)[1]
            raw = base64.b64decode(b64)
            img = Image.open(io.BytesIO(raw)).convert('RGB').resize((IMAGE_SIZE, IMAGE_SIZE))
            # Shape: (48, 48, 3) — pixel values 0-255 as floats
            images.append(np.array(img, dtype=np.float32))
        classes.append({'name': cls['name'], 'images': np.array(images)})
    return classes


def extract_features(classes, job):
    """
    This is the key step of transfer learning:

    Instead of training on raw pixels (48×48×3 = 6912 numbers per image),
    we run each image through the frozen MobileNet to get a compact
    "feature vector" (256 numbers per image).

    These 256 numbers encode high-level patterns MobileNet learned from
    ImageNet — edges, textures, shapes. Our small classifier head only
    needs to learn which combination of these features means "plus" vs
    "minus" vs "multiply". Much easier than learning from raw pixels.

    Returns:
      xs: feature matrix, shape (total_images, 256)
           — each row is one image's feature vector
      ys: one-hot labels, shape (total_images, num_classes)
           — e.g. [1,0,0] = class 0, [0,1,0] = class 1
           (Andrew Ng calls this the "Y matrix")
    """
    import tensorflow as tf

    truncated, mn_size = _get_mobilenet()
    job['status'] = 'extracting_features'

    all_features = []
    all_labels = []
    num_classes = len(classes)

    for i, cls in enumerate(classes):
        imgs = cls['images']

        # MobileNet might need a different input size than our 48x48 images
        if mn_size != IMAGE_SIZE:
            resized = tf.image.resize(imgs, [mn_size, mn_size])
        else:
            resized = imgs

        # Normalize pixels from [0, 255] to [-1, 1] — MobileNet was trained
        # with this range, so we must match it
        normalized = resized / 127.5 - 1.0

        # Run images through frozen MobileNet → get feature maps
        # Shape: (num_images, h, w, channels)
        features = truncated.predict(normalized, verbose=0)

        # Flatten spatial dims: (num_images, h, w, channels) → (num_images, 256)
        flat = features.reshape(features.shape[0], -1)
        all_features.append(flat)

        # Label each image with its class index (0, 1, 2, ...)
        all_labels.append(np.full(len(imgs), i))

    # Stack all classes together into single arrays
    xs = np.concatenate(all_features, axis=0)    # (total_images, 256)
    ys_idx = np.concatenate(all_labels, axis=0)  # (total_images,) e.g. [0,0,0,1,1,1,2,2,2]

    # Convert to one-hot: index 1 with 3 classes → [0, 1, 0]
    # np.eye(3) = [[1,0,0],[0,1,0],[0,0,1]], indexing picks the right row
    ys = np.eye(num_classes)[ys_idx.astype(int)]
    return xs, ys


def train_head(xs, ys, config, job):
    """
    Train a small neural network ("head") on top of MobileNet's features.

    This is what you learned in Andrew Ng's course — a simple feedforward net:

      Input (256 features)
        → Dense layer (100 neurons, ReLU activation)
        → Output layer (num_classes neurons, Softmax activation)

    The MobileNet below is FROZEN — we don't change its weights.
    We only train these two small layers. This is why transfer learning
    is fast: instead of training millions of weights, we train ~25,000.

    Softmax converts raw scores to probabilities that sum to 1:
      [2.1, 0.5, -0.3] → [0.78, 0.16, 0.06] = 78% class 0, 16% class 1, 6% class 2

    Loss function is categorical_crossentropy — same as "log loss" from
    Andrew's course. Optimizer is Adam (adaptive learning rate SGD).
    """
    import tensorflow as tf

    job['status'] = 'training'
    feature_size = xs.shape[1]   # 256
    num_classes = ys.shape[1]    # e.g. 3 for plus/minus/multiply
    epochs = config.get('epochs', 50)
    batch_size = config.get('batchSize', 16)
    lr = config.get('learningRate', 0.001)
    dense_units = config.get('denseUnits', 100)

    # Two-layer classifier head
    head = tf.keras.Sequential([
        # Hidden layer: 256 inputs → 100 neurons, ReLU kills negatives
        tf.keras.layers.Dense(
            dense_units, activation='relu', use_bias=True,
            input_shape=(feature_size,), name='head_dense1',
        ),
        # Output layer: 100 → num_classes, softmax gives probabilities
        tf.keras.layers.Dense(
            num_classes, activation='softmax', use_bias=False,
            name='head_dense2',
        ),
    ])

    head.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=lr),
        loss='categorical_crossentropy',  # -sum(y * log(y_hat))
        metrics=['accuracy'],
    )

    # Report progress to the frontend after each epoch
    class ProgressCallback(tf.keras.callbacks.Callback):
        def on_epoch_end(self, epoch, logs=None):
            job['progress'] = {
                'epoch': epoch + 1,
                'totalEpochs': epochs,
                'loss': round(float(logs.get('loss', 0)), 4),
                'accuracy': round(float(logs.get('accuracy', 0)), 4),
            }

    head.fit(
        xs, ys,                    # training data: features and labels
        epochs=epochs,             # how many full passes through the data
        batch_size=batch_size,     # samples per gradient update step
        validation_split=0.15 if xs.shape[0] > 10 else 0.0,  # hold out 15% to check overfitting
        shuffle=True,              # randomize order each epoch
        verbose=0,                 # silent — we use the callback instead
        callbacks=[ProgressCallback()],
    )

    return head


def build_full_model(head, labels):
    """
    Combine everything into one model for deployment:

      Raw image (48×48×3, pixels 0-255)
        → Resize to MobileNet's input size (if different)
        → Normalize to [-1, 1]
        → MobileNet feature extractor (frozen, pre-trained)
        → Flatten to 1D vector
        → Dense head (the part we just trained)
        → Class probabilities

    During training we ran MobileNet and the head separately (for speed —
    extract features once, train head many epochs). For deployment we need
    one model that goes from raw image → prediction.

    We create new Dense layers and copy the trained weights into them
    (can't directly reuse Sequential layers in a Functional model).
    """
    import tensorflow as tf

    truncated, mn_size = _get_mobilenet()
    num_classes = len(labels)

    # Entry point: raw 48x48 RGB image as float (0-255)
    inp = tf.keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), dtype=tf.float32, name='input_image')
    x = inp

    # Resize if MobileNet needs a different size than 48x48
    if mn_size != IMAGE_SIZE:
        x = tf.keras.layers.Resizing(mn_size, mn_size)(x)

    # Normalize [0,255] → [-1,1] to match MobileNet's expected input
    x = tf.keras.layers.Rescaling(scale=1.0 / 127.5, offset=-1.0)(x)

    # Run through frozen MobileNet → feature maps
    x = truncated(x, training=False)

    # Flatten: (1, h, w, 256) → (1, 256)
    x = tf.keras.layers.Flatten()(x)

    # Copy trained weights from the head we trained above
    d1_w = head.get_layer('head_dense1').get_weights()  # [kernel, bias]
    d2_w = head.get_layer('head_dense2').get_weights()  # [kernel] (no bias)

    # Recreate the same Dense layers with same sizes
    x = tf.keras.layers.Dense(
        d1_w[0].shape[1], activation='relu', use_bias=True, name='full_dense1',
    )(x)
    x = tf.keras.layers.Dense(
        num_classes, activation='softmax', use_bias=False, name='full_dense2',
    )(x)

    full_model = tf.keras.Model(inputs=inp, outputs=x, name='m3d_classifier')

    # Paste in the trained weights
    full_model.get_layer('full_dense1').set_weights(d1_w)
    full_model.get_layer('full_dense2').set_weights(d2_w)

    return full_model


def convert_to_tflite(full_model, labels, output_dir):
    """
    Convert the Keras model to TFLite int8 format for ESP32.

    ESP32 can't run a Keras model — it needs TFLite, a stripped-down format
    optimized for microcontrollers. int8 quantization converts all weights
    from 32-bit floats to 8-bit integers:

      - Model size drops ~4× (float32 → int8)
      - ESP32 does integer math much faster than float
      - Tiny accuracy loss, usually negligible

    The "representative dataset" feeds random images through the model so
    the converter can figure out the right scale factors for int8 conversion
    (it needs to know the typical range of values at each layer).

    Input/output are uint8 (0-255) — so ESP32 can feed raw camera pixels
    directly, no float conversion needed on-device.
    """
    import tensorflow as tf

    # 100 random images to calibrate int8 quantization ranges
    def representative_dataset():
        for _ in range(100):
            yield [np.random.randint(0, 256, (1, IMAGE_SIZE, IMAGE_SIZE, 3)).astype(np.float32)]

    converter = tf.lite.TFLiteConverter.from_keras_model(full_model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.uint8   # input: raw pixels 0-255
    converter.inference_output_type = tf.uint8  # output: probabilities as 0-255
    tflite_bytes = converter.convert()

    tflite_path = os.path.join(output_dir, 'model.tflite')
    with open(tflite_path, 'wb') as f:
        f.write(tflite_bytes)

    labels_path = os.path.join(output_dir, 'labels.txt')
    with open(labels_path, 'w') as f:
        for label in labels:
            f.write(label + '\n')

    return os.path.getsize(tflite_path) // 1024  # size in KB


def run_inference(job, image_b64):
    """
    Run prediction on a single image using the TFLite model from disk.

    This mimics what the ESP32 does: load the .tflite file, feed in a
    uint8 image, get uint8 probabilities out. We divide by 255 to convert
    back to 0.0-1.0 range for the API response.

    Uses tf.lite.Interpreter — the same lightweight runtime that TFLite
    Micro uses on ESP32 (just the Python version of it).
    """
    import tensorflow as tf

    tflite_path = os.path.join(job['output_dir'], 'model.tflite')
    if not os.path.exists(tflite_path):
        raise ValueError('Model not ready')

    # Decode base64 image → 48×48 RGB uint8 array
    if ',' in image_b64:
        image_b64 = image_b64.split(',', 1)[1]
    raw = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(raw)).convert('RGB').resize((IMAGE_SIZE, IMAGE_SIZE))
    arr = np.array(img, dtype=np.uint8)       # (48, 48, 3) values 0-255
    batch = np.expand_dims(arr, 0)            # (1, 48, 48, 3) — add batch dim

    # Load TFLite model and run inference
    interpreter = tf.lite.Interpreter(model_path=tflite_path)
    interpreter.allocate_tensors()
    interpreter.set_tensor(interpreter.get_input_details()[0]['index'], batch)
    interpreter.invoke()
    preds = interpreter.get_tensor(interpreter.get_output_details()[0]['index'])[0]

    # Output is uint8 (0-255), convert to probabilities (0.0-1.0)
    preds = preds.astype(np.float32) / 255.0
    labels = job['labels']
    return [{'className': labels[i], 'probability': round(float(preds[i]), 4)} for i in range(len(labels))]


def export_tfjs_head(head, feature_size, labels, output_dir):
    """Export head model in TF.js format for browser live preview."""
    d1_kernel, d1_bias = head.get_layer('head_dense1').get_weights()
    d2_kernel = head.get_layer('head_dense2').get_weights()[0]

    weights_data = b''
    weights_manifest = []
    for name, arr in [
        ('dense_Dense1/kernel', d1_kernel),
        ('dense_Dense1/bias', d1_bias),
        ('dense_Dense2/kernel', d2_kernel),
    ]:
        weights_data += arr.astype(np.float32).tobytes()
        weights_manifest.append({
            'name': name, 'shape': list(arr.shape), 'dtype': 'float32',
        })

    model_json = {
        'modelTopology': {
            'class_name': 'Sequential',
            'config': {
                'name': 'sequential_1',
                'layers': [
                    {
                        'class_name': 'Dense',
                        'config': {
                            'units': int(d1_kernel.shape[1]),
                            'activation': 'relu',
                            'use_bias': True,
                            'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1, 'mode': 'fan_in', 'distribution': 'normal', 'seed': None}},
                            'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                            'kernel_regularizer': None, 'bias_regularizer': None,
                            'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                            'name': 'dense_Dense1', 'trainable': True,
                            'batch_input_shape': [None, int(feature_size)],
                            'dtype': 'float32',
                        },
                    },
                    {
                        'class_name': 'Dense',
                        'config': {
                            'units': len(labels),
                            'activation': 'softmax',
                            'use_bias': False,
                            'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1, 'mode': 'fan_in', 'distribution': 'normal', 'seed': None}},
                            'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                            'kernel_regularizer': None, 'bias_regularizer': None,
                            'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                            'name': 'dense_Dense2', 'trainable': True,
                        },
                    },
                ],
            },
            'keras_version': 'tfjs-layers 4.22.0',
            'backend': 'tensor_flow.js',
        },
        'format': 'layers-model',
        'generatedBy': 'M3D TFLite Trainer',
        'convertedBy': None,
        'weightsManifest': [{
            'paths': ['./model.weights.bin'],
            'weights': weights_manifest,
        }],
    }

    with open(os.path.join(output_dir, 'model.json'), 'w') as f:
        json.dump(model_json, f)

    with open(os.path.join(output_dir, 'model.weights.bin'), 'wb') as f:
        f.write(weights_data)


def run_training(job, class_data, config):
    """
    Full training pipeline — runs in a background thread.

    The overall flow (this is transfer learning):
      1. Load pre-trained MobileNet (feature extractor)
      2. Decode user's images from base64
      3. Run all images through MobileNet → feature vectors
      4. Train a small 2-layer head on those features
      5. Stitch MobileNet + head into one model
      6. Convert to int8 TFLite for ESP32

    Steps 3-4 are the transfer learning trick: MobileNet already knows
    how to "see" — we just teach a small classifier what to look for.
    """
    try:
        output_dir = job['output_dir']
        os.makedirs(output_dir, exist_ok=True)

        job['status'] = 'loading_model'
        _get_mobilenet()

        classes = decode_images(class_data)
        labels = [c['name'] for c in classes]
        job['labels'] = labels

        # Step 3: images → feature vectors via frozen MobileNet
        xs, ys = extract_features(classes, job)
        feature_size = xs.shape[1]

        # Step 4: train small head on features
        head = train_head(xs, ys, config, job)

        # Steps 5-6: combine into full model and convert for ESP32
        job['status'] = 'converting'
        full_model = build_full_model(head, labels)
        tflite_kb = convert_to_tflite(full_model, labels, output_dir)

        job['status'] = 'done'
        job['tfliteSize'] = tflite_kb
        job['featureSize'] = feature_size
        print(f"Job {job['id']} done: {len(labels)} classes, {tflite_kb} KB")

    except Exception as e:
        job['status'] = 'error'
        job['error'] = str(e)
        import traceback
        traceback.print_exc()
