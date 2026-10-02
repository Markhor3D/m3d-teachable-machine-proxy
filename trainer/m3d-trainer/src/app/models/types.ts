export type CameraSource = 'm3d' | 'webcam';

export interface SampleImage {
  id: string;
  thumbnail: string;
  element: HTMLCanvasElement;
}

export interface ClassData {
  id: string;
  name: string;
  samples: SampleImage[];
}

export interface TrainingConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  denseUnits: number;
}

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy: number;
}

export interface PredictionResult {
  className: string;
  probability: number;
}
