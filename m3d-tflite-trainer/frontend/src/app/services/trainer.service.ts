import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ClassData, TrainingConfig, TrainingProgress, PredictionResult } from '../models/types';

const POLL_INTERVAL = 500;

@Injectable({ providedIn: 'root' })
export class TrainerService {
  readonly trainingProgress$ = new BehaviorSubject<TrainingProgress | null>(null);
  readonly predictions$ = new BehaviorSubject<PredictionResult[]>([]);
  readonly isTraining = signal(false);
  readonly isTrained = signal(false);
  readonly status = signal('');

  private labels: string[] = [];
  private currentJobId: string | null = null;

  tfliteUrl: string | null = null;
  labelsUrl: string | null = null;
  headerUrl: string | null = null;
  tfliteSize: number | null = null;

  async train(classes: ClassData[], config: TrainingConfig): Promise<void> {
    this.isTraining.set(true);
    this.trainingProgress$.next(null);
    this.status.set('Preparing images…');

    try {
      const classPayload = classes.map(c => ({
        name: c.name,
        images: c.samples.map(s => s.element.toDataURL('image/jpeg', 0.9)),
      }));

      this.status.set('Uploading…');
      const res = await fetch('/api/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classes: classPayload, config }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Training request failed');
      }

      const { jobId } = await res.json();
      this.currentJobId = jobId;

      await this.pollJob(jobId);
    } finally {
      this.isTraining.set(false);
      this.status.set('');
    }
  }

  private static readonly STATUS_LABELS: Record<string, string> = {
    queued: 'Queued…',
    loading_model: 'Loading MobileNet…',
    extracting_features: 'Extracting features…',
    training: 'Training…',
    converting: 'Converting to TFLite…',
    done: 'Done',
  };

  private async pollJob(jobId: string): Promise<void> {
    while (true) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      const res = await fetch(`/api/jobs/${jobId}`);
      const job = await res.json();

      this.status.set(TrainerService.STATUS_LABELS[job.status] ?? job.status);

      if (job.progress) {
        this.trainingProgress$.next(job.progress);
      }

      if (job.status === 'done') {
        this.labels = job.labels;
        this.tfliteUrl = job.tfliteUrl;
        this.labelsUrl = job.labelsUrl;
        this.tfliteSize = job.tfliteSize;
        this.headerUrl = job.headerUrl;
        this.isTrained.set(true);
        return;
      }

      if (job.status === 'error') {
        throw new Error(job.error || 'Training failed');
      }
    }
  }

  async predict(source: HTMLCanvasElement): Promise<PredictionResult[]> {
    if (!this.currentJobId || !this.isTrained()) return [];

    const imageB64 = source.toDataURL('image/jpeg', 0.9);

    const res = await fetch(`/api/jobs/${this.currentJobId}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageB64 }),
    });

    if (!res.ok) return [];

    const data = await res.json();
    const predictions: PredictionResult[] = data.predictions;
    this.predictions$.next(predictions);
    return predictions;
  }

  reset(): void {
    this.currentJobId = null;
    this.tfliteUrl = null;
    this.labelsUrl = null;
    this.headerUrl = null;
    this.tfliteSize = null;
    this.isTrained.set(false);
    this.status.set('');
    this.predictions$.next([]);
    this.trainingProgress$.next(null);
  }
}
