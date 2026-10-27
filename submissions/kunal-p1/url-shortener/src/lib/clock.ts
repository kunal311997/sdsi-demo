/** Injectable clock so expiry and click-bucketing are deterministic in tests. */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A clock that can be advanced manually; used by tests and the demo script. */
export function fixedClock(
  start: number,
): Clock & { set: (value: number) => void; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    set: (value: number) => {
      current = value;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}
