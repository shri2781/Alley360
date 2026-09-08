export type EstimatorConfig = {
  /** The whole model. Minutes one player takes to bowl one game. */
  perPlayerPerGameMin: number;
  /** Bookings both START and LAST a multiple of this. Because both align, a booking
   *  always ends on the grid and the next one can begin there with no gap at all. */
  bookingGridMin: number;
  /** Staff timeline drag snapping only — deliberately finer than bookingGridMin so the
   *  board can be corrected by hand to the minute. */
  slotGridMin: number;
  /** Smallest allowed span for a staff-dragged open_play allocation. */
  minPlayBlockMin: number;
  /** Smallest allowed span for a maintenance allocation (kind: 'block'). */
  minMaintenanceBlockMin: number;
};

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = {
  perPlayerPerGameMin: 9,
  bookingGridMin: 10,
  slotGridMin: 1,
  minPlayBlockMin: 1,
  minMaintenanceBlockMin: 1,
};
