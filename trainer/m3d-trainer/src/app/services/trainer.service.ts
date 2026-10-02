import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ClassData, TrainingConfig, TrainingProgress, PredictionResult } from '../models/types';
import * as tf from '@tensorflow/tfjs';

const IMAGE_SIZE = 48;

@Injectable({ providedIn: 'root' })
export class TrainerService {
  readonly trainingProgress$ = new BehaviorSubject<TrainingProgress | null>(null);
  readonly predictions$ = new BehaviorSubject<PredictionResult[]>([]);
  readonly isTraining = signal(false);
  readonly isTrained = signal(false);

  private truncatedModel: tf.LayersModel | null = null;
  private headModel: tf.Sequential | null = null;
  private labels: string[] = [];

  private async loadBaseModel(): Promise<void> {
    if (this.truncatedModel) return;
    await tf.ready();

    const mobilenet = await tf.loadLayersModel(
      'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json'
    );

    // Rebuild MobileNet with IMAGE_SIZE input — conv weights are resolution-independent
    const newInput = tf.input({shape: [IMAGE_SIZE, IMAGE_SIZE, 3]});
    let x: tf.SymbolicTensor = newInput;
    for (const layer of mobilenet.layers) {
      if (layer.getClassName() === 'InputLayer') continue;
      x = layer.apply(x) as tf.SymbolicTensor;
      if (layer.name === 'conv_pw_13_relu') break;
    }

    this.truncatedModel = tf.model({ inputs: newInput, outputs: x });
  }

  private canvasToTensor(canvas: HTMLCanvasElement): tf.Tensor4D {
    return tf.tidy(() => {
      const img = tf.browser.fromPixels(canvas);
      const resized = tf.image.resizeBilinear(img, [IMAGE_SIZE, IMAGE_SIZE]);
      const normalized = resized.toFloat().div(127.5).sub(1);
      return normalized.expandDims(0) as tf.Tensor4D;
    });
  }

  private extractFeatures(canvas: HTMLCanvasElement): tf.Tensor {
    return tf.tidy(() => {
      const input = this.canvasToTensor(canvas);
      const features = this.truncatedModel!.predict(input) as tf.Tensor;
      return features.reshape([1, -1]).squeeze();
    });
  }

  async train(classes: ClassData[], config: TrainingConfig): Promise<void> {
    await this.loadBaseModel();
    this.isTraining.set(true);
    this.trainingProgress$.next(null);

    try {
      this.labels = classes.map(c => c.name);
      const numClasses = classes.length;

      console.log('Extracting features from', classes.reduce((s, c) => s + c.samples.length, 0), 'samples...');

      const featureArrays: tf.Tensor[] = [];
      const labelArrays: tf.Tensor[] = [];

      for (let i = 0; i < classes.length; i++) {
        for (const sample of classes[i].samples) {
          featureArrays.push(this.extractFeatures(sample.element));
          labelArrays.push(tf.oneHot(i, numClasses));
        }
      }

      const xs = tf.stack(featureArrays);
      const ys = tf.stack(labelArrays);
      featureArrays.forEach(t => t.dispose());
      labelArrays.forEach(t => t.dispose());

      const featureSize = xs.shape[1]!;
      console.log(`Feature size: ${featureSize}, total samples: ${xs.shape[0]}`);

      this.headModel = tf.sequential();
      this.headModel.add(tf.layers.dense({
        inputShape: [featureSize],
        units: config.denseUnits,
        activation: 'relu',
        kernelInitializer: 'varianceScaling',
        useBias: true,
      }));
      this.headModel.add(tf.layers.dense({
        units: numClasses,
        activation: 'softmax',
        kernelInitializer: 'varianceScaling',
        useBias: false,
      }));

      this.headModel.compile({
        optimizer: tf.train.adam(config.learningRate),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy'],
      });

      await this.headModel.fit(xs, ys, {
        epochs: config.epochs,
        batchSize: config.batchSize,
        validationSplit: 0.15,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch: number, logs: any) => {
            this.trainingProgress$.next({
              epoch: epoch + 1,
              totalEpochs: config.epochs,
              loss: logs.loss,
              accuracy: logs.acc,
            });
          },
        },
      });

      xs.dispose();
      ys.dispose();

      this.isTrained.set(true);
      console.log('Training complete');
    } finally {
      this.isTraining.set(false);
    }
  }

  async predict(source: HTMLCanvasElement): Promise<PredictionResult[]> {
    if (!this.truncatedModel || !this.headModel) return [];

    const probabilities = tf.tidy(() => {
      const input = this.canvasToTensor(source);
      const features = this.truncatedModel!.predict(input) as tf.Tensor;
      const flat = features.reshape([1, -1]);
      const preds = this.headModel!.predict(flat) as tf.Tensor;
      return preds.dataSync();
    });

    const predictions: PredictionResult[] = this.labels.map((label, i) => ({
      className: label,
      probability: probabilities[i],
    }));
    this.predictions$.next(predictions);
    return predictions;
  }

  async exportModel(filename: string): Promise<void> {
    if (!this.headModel) return;

    await this.headModel.save('downloads://' + filename);

    const metadata = {
      imageSize: IMAGE_SIZE,
      baseModel: 'mobilenet_v1_0.25_224',
      truncationLayer: 'conv_pw_13_relu',
      labels: this.labels,
      modelName: filename,
      timeStamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '_metadata.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  reset(): void {
    if (this.headModel) {
      this.headModel.dispose();
      this.headModel = null;
    }
    this.isTrained.set(false);
    this.predictions$.next([]);
    this.trainingProgress$.next(null);
  }
}
