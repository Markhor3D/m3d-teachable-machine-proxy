import { Component, OnInit, OnDestroy, signal, ChangeDetectionStrategy } from '@angular/core';
import { TrainerService } from '../../services/trainer.service';
import { CameraService } from '../../services/camera.service';
import { PredictionResult } from '../../models/types';

@Component({
  selector: 'app-prediction-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="prediction-panel">
      <h3>Prediction</h3>
      @for (pred of predictions(); track pred.className) {
        <div class="pred-row">
          <span class="pred-label">{{ pred.className }}</span>
          <div class="pred-bar-bg">
            <div
              class="pred-bar-fill"
              [style.width.%]="pred.probability * 100"
              [class.high]="pred.probability > 0.5">
            </div>
          </div>
          <span class="pred-value">{{ (pred.probability * 100).toFixed(0) }}%</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .prediction-panel {
      background: #1e1e30;
      border-radius: 10px;
      padding: 16px;
    }
    h3 {
      margin: 0 0 12px;
      color: #ddd;
      font-size: 16px;
    }
    .pred-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .pred-label {
      width: 80px;
      font-size: 13px;
      color: #ccc;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pred-bar-bg {
      flex: 1;
      height: 20px;
      background: #2a2a3e;
      border-radius: 4px;
      overflow: hidden;
    }
    .pred-bar-fill {
      height: 100%;
      background: #666;
      border-radius: 4px;
      transition: width 0.15s;
    }
    .pred-bar-fill.high { background: #4a6cf7; }
    .pred-value {
      width: 40px;
      text-align: right;
      font-size: 13px;
      color: #aaa;
      font-weight: 600;
    }
  `],
})
export class PredictionPanelComponent implements OnInit, OnDestroy {
  readonly predictions = signal<PredictionResult[]>([]);
  private active = false;

  constructor(
    private trainerService: TrainerService,
    private cameraService: CameraService
  ) {}

  ngOnInit(): void {
    this.active = true;
    this.runLoop();
  }

  ngOnDestroy(): void {
    this.active = false;
  }

  private async runLoop(): Promise<void> {
    if (!this.active) return;
    try {
      const frame = this.cameraService.captureFrame();
      const results = await this.trainerService.predict(frame);
      this.predictions.set(results);
    } catch { /* prediction failed, skip frame */ }
    requestAnimationFrame(() => {
      setTimeout(() => this.runLoop(), 80);
    });
  }
}
