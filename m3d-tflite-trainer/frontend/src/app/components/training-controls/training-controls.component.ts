import { Component, Output, EventEmitter, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { TrainingConfig } from '../../models/types';
import { TrainerService } from '../../services/trainer.service';

@Component({
  selector: 'app-training-controls',
  standalone: true,
  imports: [FormsModule, AsyncPipe],
  template: `
    <div class="training-panel">
      <h3>Training</h3>

      <div class="param-grid">
        <label>Epochs
          <input type="number" [(ngModel)]="config.epochs" min="1" max="500" />
        </label>
        <label>Batch Size
          <input type="number" [(ngModel)]="config.batchSize" min="1" max="128" />
        </label>
        <label>Learning Rate
          <input type="number" [(ngModel)]="config.learningRate" min="0.0001" max="0.1" step="0.0001" />
        </label>
        <label>Dense Units
          <input type="number" [(ngModel)]="config.denseUnits" min="10" max="512" />
        </label>
      </div>

      <button
        class="train-btn"
        [disabled]="!canTrain || trainerService.isTraining()"
        (click)="onTrain.emit(config)">
        {{ trainerService.isTraining() ? trainerService.status() : 'Train Model' }}
      </button>

      @if (trainerService.isTraining()) {
        <div class="progress-section">
          @if (trainerService.trainingProgress$ | async; as progress) {
            <div class="progress-bar-bg">
              <div
                class="progress-bar-fill"
                [style.width.%]="(progress.epoch / progress.totalEpochs) * 100">
              </div>
            </div>
            <div class="progress-stats">
              <span>Epoch {{ progress.epoch }}/{{ progress.totalEpochs }}</span>
              <span>Loss: {{ progress.loss.toFixed(4) }}</span>
              <span>Acc: {{ (progress.accuracy * 100).toFixed(1) }}%</span>
            </div>
          } @else {
            <div class="progress-bar-bg">
              <div class="progress-bar-fill indeterminate"></div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .training-panel {
      background: #1e1e30;
      border-radius: 10px;
      padding: 16px;
    }
    h3 {
      margin: 0 0 12px;
      color: #ddd;
      font-size: 16px;
    }
    .param-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 14px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: #999;
    }
    input[type="number"] {
      background: #2a2a3e;
      border: 1px solid #444;
      border-radius: 6px;
      color: #eee;
      padding: 6px 8px;
      font-size: 14px;
    }
    .train-btn {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #4a6cf7;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .train-btn:hover:not(:disabled) { background: #3a5ce7; }
    .train-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .progress-section { margin-top: 12px; }
    .progress-bar-bg {
      height: 6px;
      background: #2a2a3e;
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: #4caf50;
      transition: width 0.3s;
    }
    .progress-bar-fill.indeterminate {
      width: 30%;
      animation: slide 1.2s ease-in-out infinite;
    }
    @keyframes slide {
      0% { margin-left: 0; }
      50% { margin-left: 70%; }
      100% { margin-left: 0; }
    }
    .progress-stats {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #888;
      margin-top: 6px;
    }
  `],
})
export class TrainingControlsComponent {
  @Input() canTrain = false;
  @Output() onTrain = new EventEmitter<TrainingConfig>();

  config: TrainingConfig = {
    epochs: 50,
    batchSize: 16,
    learningRate: 0.001,
    denseUnits: 100,
  };

  constructor(public trainerService: TrainerService) {}
}
