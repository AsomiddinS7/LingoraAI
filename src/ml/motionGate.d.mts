interface MotionInput { vectors: readonly (readonly number[])[] }
export function motionSpan(input: MotionInput): number;
export function referenceMotionFloor(references: readonly MotionInput[]): number;
