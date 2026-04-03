export interface Filter {
  name: string;
  matrix: number[];
}

export interface Adjustment {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  sepia: number;
  grayscale: number;
}

export const INITIAL_ADJUSTMENTS: Adjustment = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  blur: 0,
  sepia: 0,
  grayscale: 0,
};

export type Tool = 'none' | 'adjust' | 'filter' | 'crop' | 'draw' | 'ai';
