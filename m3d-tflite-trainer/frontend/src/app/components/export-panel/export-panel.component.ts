import { Component } from '@angular/core';
import { TrainerService } from '../../services/trainer.service';

@Component({
  selector: 'app-export-panel',
  standalone: true,
  template: `
    <div class="export-panel">
      <h3>Export for ESP32</h3>
      @if (trainer.tfliteUrl) {
        <div class="file-info">TFLite model: {{ trainer.tfliteSize }} KB</div>
        <div class="btn-row">
          <a class="export-btn" [href]="trainer.tfliteUrl" download="model.tflite">Download .tflite</a>
          <a class="export-btn labels-btn" [href]="trainer.labelsUrl" download="labels.txt">Download labels</a>
        </div>
        <a class="export-btn header-btn" [href]="trainer.headerUrl" download="m3d_model.h">Download C header (.h)</a>
      } @else {
        <div class="placeholder">Train a model first</div>
      }
    </div>
  `,
  styles: [`
    .export-panel {
      background: #1e1e30;
      border-radius: 10px;
      padding: 16px;
    }
    h3 {
      margin: 0 0 12px;
      color: #ddd;
      font-size: 16px;
    }
    .file-info {
      color: #aaa;
      font-size: 13px;
      margin-bottom: 10px;
    }
    .btn-row {
      display: flex;
      gap: 8px;
    }
    .export-btn {
      flex: 1;
      display: block;
      text-align: center;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #2e7d32;
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .export-btn:hover { background: #1b5e20; }
    .labels-btn { background: #3a3a5e; }
    .labels-btn:hover { background: #4a4a6e; }
    .header-btn {
      display: block;
      text-align: center;
      margin-top: 8px;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #1565c0;
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .header-btn:hover { background: #0d47a1; }
    .placeholder {
      color: #666;
      font-size: 13px;
      text-align: center;
      padding: 8px;
    }
  `],
})
export class ExportPanelComponent {
  constructor(public trainer: TrainerService) {}
}
