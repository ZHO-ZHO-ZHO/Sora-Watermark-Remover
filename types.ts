export enum ProcessingState {
  IDLE = 'idle',
  EXTRACTING = 'extracting',
  EXTRACTED = 'extracted',
  PROCESSING = 'processing',
  DONE = 'done',
  ASSEMBLING = 'assembling',
  ERROR = 'error',
}

export interface FrameData {
  id: number;
  original: string;
  processed: string | null;
}