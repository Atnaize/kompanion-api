import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TrainingSession {
  date: string;
  length: string;
  pace: string;
  extra: string;
  day: number;
}

interface TrainingWeek {
  week: number;
  start_date: string;
  end_date: string;
  sessions: TrainingSession[];
}

interface TrainingProgram {
  title: string;
  start_date: string;
  objective: string;
  duration_weeks: number;
  weeks: TrainingWeek[];
  total_sessions: number;
}

export class TrainingService {
  private program: TrainingProgram | null = null;

  /**
   * Load the marathon training program from JSON file
   */
  private loadProgram(): TrainingProgram {
    if (this.program) {
      return this.program;
    }

    const filePath = join(__dirname, '../../data/marathon-training-program.json');
    const fileContent = readFileSync(filePath, 'utf-8');
    this.program = JSON.parse(fileContent) as TrainingProgram;

    return this.program;
  }

  /**
   * Get the full training program
   */
  getProgram(): TrainingProgram {
    return this.loadProgram();
  }

  /**
   * Get a specific week from the training program
   */
  getWeek(weekNumber: number): TrainingWeek | null {
    const program = this.loadProgram();
    return program.weeks.find((week) => week.week === weekNumber) || null;
  }

  /**
   * Get current week based on today's date
   */
  getCurrentWeek(): TrainingWeek | null {
    const program = this.loadProgram();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const week of program.weeks) {
      const startDate = new Date(week.start_date);
      const endDate = new Date(week.end_date);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      if (today >= startDate && today <= endDate) {
        return week;
      }
    }

    return null;
  }
}
