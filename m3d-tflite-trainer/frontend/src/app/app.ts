import { Component } from '@angular/core';
import { CameraPreviewComponent } from './components/camera-preview/camera-preview.component';
import { ClassPanelComponent } from './components/class-panel/class-panel.component';
import { TrainingControlsComponent } from './components/training-controls/training-controls.component';
import { PredictionPanelComponent } from './components/prediction-panel/prediction-panel.component';
import { ExportPanelComponent } from './components/export-panel/export-panel.component';
import { TrainerService } from './services/trainer.service';
import { ClassData, TrainingConfig } from './models/types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CameraPreviewComponent,
    ClassPanelComponent,
    TrainingControlsComponent,
    PredictionPanelComponent,
    ExportPanelComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  classes: ClassData[] = [
    { id: crypto.randomUUID(), name: 'Class 1', samples: [] },
    { id: crypto.randomUUID(), name: 'Class 2', samples: [] },
  ];

  constructor(public trainerService: TrainerService) {}

  get canTrain(): boolean {
    return (
      this.classes.length >= 2 &&
      this.classes.every(c => c.samples.length > 0) &&
      !this.trainerService.isTraining()
    );
  }

  addClass(): void {
    this.classes.push({
      id: crypto.randomUUID(),
      name: `Class ${this.classes.length + 1}`,
      samples: [],
    });
  }

  removeClass(id: string): void {
    if (this.classes.length <= 2) return;
    this.classes = this.classes.filter(c => c.id !== id);
  }

  async train(config: TrainingConfig): Promise<void> {
    await this.trainerService.train(this.classes, config);
  }
}
