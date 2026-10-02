import { Component } from '@angular/core';
import { TrainerService } from '../../services/trainer.service';

@Component({
  selector: 'app-export-panel',
  standalone: true,
  template: `
    <div class="export-panel">
      <h3>Export</h3>
      <button class="export-btn" (click)="download()">Download Model</button>
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
    .export-btn {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #2e7d32;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .export-btn:hover { background: #1b5e20; }
  `],
})
export class ExportPanelComponent {
  constructor(private trainerService: TrainerService) {}

  download(): void {
    this.trainerService.exportModel('m3d-model');
  }
}
